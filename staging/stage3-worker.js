import worker from "../src/index.js";
import { finalizeCredits, reserveCredits } from "../src/credit-ledger.js";
import { providerSpendBudget } from "../src/provider-spend-budget.js";
import { runJournaledInferencePrototype } from "../src/stage3-journaled-inference.js";
import { sha256Hex } from "../src/http.js";

const allowedPaths = new Set(["/api/chat", "/api/public/chat", "/api/integrations/telegram/webhook"]);
const operatorKey = /^[a-f0-9]{64}$/;
const requestKey = /^[a-f0-9]{32}$/;
const syntheticTariff = {
  approved: true,
  version: "stage3-synthetic-v1",
  provider: "stage3-synthetic",
  inputRateMicroUsdPerMillion: 293000n,
  outputRateMicroUsdPerMillion: 2253000n,
  creditNumerator: 1n,
  creditDenominator: 1n,
  maxCallMicroUsd: 9000n,
  maxCallMicrocredits: 9000n
};
const ledger = { reserve: reserveCredits, finalize: finalizeCredits };
const failingWalletLedger = { reserve: reserveCredits, finalize: async () => ({ ok: false }) };
const answer = "Analisis ini mempertimbangkan tujuan, batasan, risiko, dan langkah konkret.\nRekomendasi utama adalah memvalidasi asumsi terlebih dahulu, mengukur hasil, lalu memperbaiki pendekatan berdasarkan data yang terkumpul.";

function authorized(actual, expected) {
  if (!operatorKey.test(actual || "") || !operatorKey.test(expected || "")) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function result(error, status) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    if (!allowedPaths.has(new URL(request.url).pathname) || request.method !== "POST") {
      return result("Stage 3 route unavailable", 404);
    }
    if (env.STAGE3_MODE !== "synthetic" || !env.STAGE3_DB?.prepare) {
      return result("Stage 3 sandbox unavailable", 503);
    }
    if (!authorized(request.headers.get("X-BOR-Stage3-Key"), env.STAGE3_OPERATOR_KEY)) {
      return result("Stage 3 authentication required", 401);
    }
    const usageMode = request.headers.get("X-BOR-Stage3-Usage") || "measured";
    if (!["measured", "unverified", "wallet-finalization-failure"].includes(usageMode)) return result("Invalid synthetic usage mode", 400);

    const DB = env.STAGE3_DB;
    const providerBudget = providerSpendBudget({ DB });
    let scope;
    let modelCalls = 0;
    return worker.fetch(request, {
      DB,
      URL_READER_ENABLED: "false",
      TELEGRAM_BOT_TOKEN: "stage3-synthetic",
      TELEGRAM_WEBHOOK_SECRET: env.STAGE3_TELEGRAM_WEBHOOK_SECRET,
      TELEGRAM_FETCHER: async () => Response.json({ ok: true }),
      async STAGE3_AUTHORIZE_INFERENCE({ channel, userId, logicalId, telegramId }) {
        try {
          if (channel === "telegram") {
            if (!Number.isSafeInteger(logicalId) || logicalId < 0) return result("Invalid Telegram update ID", 400);
            const link = await DB.prepare("SELECT user_id FROM stage3_telegram_accounts WHERE telegram_id = ?").bind(telegramId).first();
            userId = link?.user_id;
            logicalId = String(logicalId);
          }
          if (!userId) return result("Stage 3 account required", 401);
          if (channel === "public") logicalId = request.headers.get("X-BOR-Stage3-Request");
          if (!logicalId || (channel === "public" && !requestKey.test(logicalId))) return result("Invalid Stage 3 request ID", 400);
          const id = await sha256Hex(JSON.stringify([channel, userId, String(logicalId).toLowerCase()]));
          // Each route supplies identity only after its normal authentication.
          const claim = await DB.prepare(
            "INSERT INTO stage3_staging_requests (id) VALUES (?) ON CONFLICT(id) DO NOTHING RETURNING id"
          ).bind(id).first();
          if (!claim) return result("Stage 3 request already submitted", 409);
          scope = { id, userId };
          return null;
        } catch {
          return result("Stage 3 sandbox schema unavailable", 503);
        }
      },
      AI: {
        async run(model, payload) {
          if (!scope) throw new Error("Stage 3 authenticated billing scope required");
          const call = ++modelCalls;
          if (call > 12) throw new Error("Stage 3 synthetic call limit exceeded");
          const billing = await runJournaledInferencePrototype({
            env: { DB },
            userId: scope.userId,
            requestId: `staging:${scope.id}:${call}`,
            attemptId: `staging:${scope.id}:${call}`,
            tariff: { ...syntheticTariff, model },
            maxInputTokens: 12000,
            maxOutputTokens: payload.max_tokens,
            providerBudget,
            ledger: usageMode === "wallet-finalization-failure" ? failingWalletLedger : ledger,
            invokeModel: async () => usageMode === "unverified"
              ? { response: answer }
              : { response: answer, usage: { prompt_tokens: 1000, completion_tokens: 100 } }
          });
          if (!billing.ok) throw new Error("Stage 3 synthetic billing declined");
          return billing.response;
        }
      }
    });
  }
};

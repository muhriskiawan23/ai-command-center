import { finalizeCredits, reserveCredits } from "../src/credit-ledger.js";
import { providerSpendBudget } from "../src/provider-spend-budget.js";
import { runJournaledInferencePrototype } from "../src/stage3-journaled-inference.js";

const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const requestId = "stage3-workers-ai-settlement-01";
const userId = "stage3-live-test-wallet";
const tariff = {
  approved: true,
  version: "sandbox-list-price-20261117",
  provider: "workers-ai-free-sandbox",
  model,
  inputRateMicroUsdPerMillion: 293000n,
  outputRateMicroUsdPerMillion: 2253000n,
  creditNumerator: 1n,
  creditDenominator: 1n,
  maxCallMicroUsd: 7069n,
  maxCallMicrocredits: 7069n
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/ready" && request.method === "GET") {
      return json({ ready: true });
    }
    if (pathname !== "/probe" || request.method !== "POST") return json({ error: "unavailable" }, 404);
    const key = request.headers.get("X-BOR-Metering-Key");
    if (!/^[a-f0-9]{64}$/.test(key ?? "") || !/^[a-f0-9]{64}$/.test(env.METERING_KEY ?? "")) {
      return json({ error: "authentication_required" }, 401);
    }
    let difference = 0;
    for (let index = 0; index < 64; index++) difference |= key.charCodeAt(index) ^ env.METERING_KEY.charCodeAt(index);
    if (difference !== 0) return json({ error: "authentication_required" }, 401);

    const bindings = { DB: env.STAGE3_DB };
    const result = await runJournaledInferencePrototype({
      env: bindings,
      userId,
      requestId,
      attemptId: requestId,
      tariff,
      maxInputTokens: 24000,
      maxOutputTokens: 16,
      providerBudget: providerSpendBudget(bindings),
      ledger: { reserve: reserveCredits, finalize: finalizeCredits },
      invokeModel: ({ model: selectedModel, maxOutputTokens }) => env.AI.run(selectedModel, {
        messages: [{ role: "user", content: "Reply with only the word OK." }],
        max_tokens: maxOutputTokens,
        stream: false
      })
    });
    if (!result.ok) {
      const status = result.reason === "provider_budget_reservation_rejected" ? 409 : 502;
      return json({ error: result.reason, modelInvoked: result.modelInvoked }, status);
    }
    return json({
      model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedMicroUsdBeforeFreeAllocation: Number(result.providerCostMicroUsd),
      syntheticDebitMicrocredits: Number(result.customerDebitMicrocredits)
    });
  }
};

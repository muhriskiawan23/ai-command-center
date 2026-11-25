import worker from "./index.js";
import { consumeUsage, usageDay } from "./daily-limits.js";
import { json, sha256Hex } from "./http.js";
import { LUNA_SEARCH_RESERVATION_MICRO_USD, runWebSearchV2 } from "./web-search-v2.js";
import { runLunaStagingEvaluation } from "./luna-staging-live-evaluation.js";
import { runProof } from "../tools/egress-proxy/runtime/probe-worker.js";

const ROUTES = new Set(["/smoke/luna", "/smoke/cloudflare", "/smoke/web-search", "/smoke/url-reader"]);

async function smokeWebSearch(request, env) {
  if (env.BOR_WEB_SEARCH_KILL_SWITCH === "true") return json({ error: "staging_smoke_disabled" }, 503);
  if (!env.BOR_WEB_SEARCH_OPENAI_KEY || !env.DB?.prepare) return json({ error: "staging_not_configured" }, 503);
  let providerStatus = null;
  const result = await runWebSearchV2({
    DB: env.DB,
    BOR_WEB_SEARCH_MODE: "v2",
    BOR_WEB_SEARCH_OPENAI_KEY: env.BOR_WEB_SEARCH_OPENAI_KEY,
    BOR_WEB_SEARCH_OPENAI_ORG: env.BOR_WEB_SEARCH_OPENAI_ORG,
    BOR_WEB_SEARCH_OPENAI_PROJECT: env.BOR_WEB_SEARCH_OPENAI_PROJECT,
    BOR_WEB_SEARCH_DAILY_CALLS: "1",
    BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(LUNA_SEARCH_RESERVATION_MICRO_USD),
    BOR_WEB_SEARCH_DAILY_MICRO_USD: String(LUNA_SEARCH_RESERVATION_MICRO_USD),
    BOR_WEB_SEARCH_MONTHLY_MICRO_USD: String(LUNA_SEARCH_RESERVATION_MICRO_USD),
    async WEB_SEARCH_V2_FETCHER(url, options) {
      const response = await fetch(url, options);
      providerStatus = response.status;
      return response;
    }
  }, { category: "company", query: "Find the official website of Hamad International Airport, Doha, and cite it." }, { signal: request.signal, singleOpenAiAttempt: true });
  const ok = result?.provider === "OpenAI" && result.links.length > 0;
  return json({ ok, providerStatus, citationsPresent: ok }, ok ? 200 : providerStatus === null ? 503 : 502);
}

async function smokeUrlReader(env) {
  if (!env.EGRESS_PROXY?.fetch || typeof env.EGRESS_PROXY_TOKEN !== "string" || env.EGRESS_PROXY_TOKEN.length < 32) {
    return json({ error: "staging_not_configured" }, 503);
  }
  try {
    return json({ ok: true, checks: await runProof(env) });
  } catch {
    return json({ ok: false, error: "staging_egress_probe_failed" }, 502);
  }
}

async function authorized(request, secret) {
  const authorization = request.headers.get("Authorization") || "";
  if (!secret || !authorization.startsWith("Bearer ") || authorization.length > 256) return false;
  const provided = await sha256Hex(authorization.slice(7));
  const expected = await sha256Hex(secret);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

// One-shot fallback when a staging Cron Trigger has not propagated.
async function handleLiveEvaluationTrigger(request, env) {
  const digest = env.BOR_LUNA_LIVE_TRIGGER_DIGEST;
  if (!/^[0-9a-f]{64}$/.test(digest || "") || Date.now() >= Number(env.BOR_LUNA_LIVE_EVAL_EXPIRES_AT || 0)) {
    return json({ error: "not_found" }, 404);
  }
  if (request.method === "GET") return new Response(
    '<!doctype html><meta charset="utf-8"><title>Luna staging evaluation</title><h1>Run the staging evaluation</h1><form method="post"><label>One-time run code <input name="code" type="password" required autocomplete="off"></label><button>Run evaluation</button></form>',
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" } }
  );
  const length = Number(request.headers.get("Content-Length"));
  if (request.method !== "POST" || request.headers.get("Origin") !== new URL(request.url).origin || length < 1 || length > 256 ||
      !request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return json({ error: "not_found" }, 404);
  const code = new URLSearchParams(await request.text()).get("code") || "";
  const provided = await sha256Hex(code);
  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= provided.charCodeAt(i) ^ digest.charCodeAt(i);
  if (difference !== 0) return json({ error: "operator_auth_required" }, 401);
  await runLunaStagingEvaluation(env);
  return json({ accepted: true });
}

export default {
  async scheduled(_event, env) { await runLunaStagingEvaluation(env); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__staging-evaluation") return handleLiveEvaluationTrigger(request, env);
    if (request.method !== "POST" || !ROUTES.has(url.pathname)) {
      return json({ error: "not_found" }, 404);
    }
    if (!await authorized(request, env.BOR_LUNA_STAGING_TOKEN)) {
      return json({ error: "operator_auth_required" }, 401);
    }
    if (url.pathname === "/smoke/web-search") {
      return env.BOR_LUNA_STAGING_WEB_SEARCH_ENABLED === "true"
        ? smokeWebSearch(request, env) : json({ error: "staging_smoke_disabled" }, 503);
    }
    if (url.pathname === "/smoke/url-reader") {
      return env.BOR_LUNA_STAGING_URL_READER_ENABLED === "true"
        ? smokeUrlReader(env) : json({ error: "staging_smoke_disabled" }, 503);
    }
    const luna = url.pathname === "/smoke/luna";
    if (!env.DB?.prepare || !env.AI?.run || (luna && !env.BOR_TEXT_BACKUP_API_KEY)) {
      return json({ error: "staging_not_configured" }, 503);
    }
    const provider = luna ? "openai" : "cloudflare-workers-ai";
    try {
      const total = await consumeUsage(env, usageDay(), "staging:smoke:" + provider, 1, 1);
      if (total === null) return json({ error: "staging_daily_smoke_limit" }, 429);

      // Synthetic prompt only. No customer sessions, docs, or routes exposed.
      const result = await worker.fetch(new Request(url.origin + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi bor", language: "id" }),
        signal: request.signal
      }), {
        DB: env.DB,
        AI: luna ? { async run() { throw new Error("Synthetic Cloudflare interruption"); } } : env.AI,
        BOR_TEXT_BACKUP_ENABLED: "true",
        BOR_TEXT_LUNA_PRIMARY: "true",
        BOR_TEXT_BACKUP_DAILY_USD_LIMIT: luna ? "0.01" : "0.000001",
        BOR_TEXT_BACKUP_API_KEY: env.BOR_TEXT_BACKUP_API_KEY,
        BOR_TEXT_AI_DAILY_USD_LIMIT: "0.05"
      });
      const answer = await result.json();
      const ok = result.ok && answer.agentModels?.[0]?.provider === provider && Boolean(answer.response?.trim());
      return json({ ok, provider, workerStatus: result.status, model: ok ? answer.model : null }, ok ? 200 : 502);
    } catch {
      return json({ ok: false, provider, error: "staging_smoke_failed" }, 502);
    }
  }
};

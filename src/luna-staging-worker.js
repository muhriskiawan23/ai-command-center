import worker from "./index.js";
import { consumeUsage, usageDay } from "./daily-limits.js";
import { json, sha256Hex } from "./http.js";

async function authorized(request, secret) {
  const authorization = request.headers.get("Authorization") || "";
  if (!secret || !authorization.startsWith("Bearer ") || authorization.length > 256) return false;
  const provided = await sha256Hex(authorization.slice(7));
  const expected = await sha256Hex(secret);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !["/smoke/luna", "/smoke/cloudflare"].includes(url.pathname)) {
      return json({ error: "not_found" }, 404);
    }
    if (!await authorized(request, env.BOR_LUNA_STAGING_TOKEN)) {
      return json({ error: "operator_auth_required" }, 401);
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

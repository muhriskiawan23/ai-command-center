import { planBrowserTask } from "./browser-task-policy.js";
import { reserveStagingBrowserSlot, releaseStagingBrowserSlot } from "./browser-staging-budget.js";
import { executeStagingBrowserRead } from "./browser-staging-executor.js";

const MAX_REQUEST_BYTES = 1200;
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'"
};
function reply(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}

async function authorized(request, expected) {
  if (typeof expected !== "string" || expected.length < 32 || expected.length > 512) return false;
  const input = request.headers.get("authorization");
  if (typeof input !== "string" || !input.startsWith("Bearer ") ||
      input.length > 520) return false;
  const supplied = input.slice(7);
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
    crypto.subtle.digest("SHA-256", enc.encode(supplied))
  ]);
  const expectedBytes = new Uint8Array(a), suppliedBytes = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < expectedBytes.length; i++) different |= expectedBytes[i] ^ suppliedBytes[i];
  return different === 0;
}

async function readSmallJSON(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_REQUEST_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      // Do not await cancel on an attacker-controlled stalled stream.
      try { void reader.cancel(); } catch {}
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export function createBrowserStagingHandler({ launch, clock = () => Date.now(), makeToken = () => crypto.randomUUID() } = {}) {
  return async function fetchBrowserStaging(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return reply({ ok: true, service: "bor-ai-browser-staging", browserAttempted: false });
    }
    if (url.pathname !== "/api/browser/read") return reply({ error: "not_found" }, 404);
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405, { Allow: "POST" });
    if (env?.STAGING_BROWSER_ENABLED !== "true") return reply({ error: "staging_disabled" }, 503);
    if (!env?.STAGING_BROWSER_OPERATOR_TOKEN || typeof launch !== "function") return reply({ error: "staging_not_ready" }, 503);
    if (!await authorized(request, env.STAGING_BROWSER_OPERATOR_TOKEN)) return reply({ error: "unauthorized" }, 401);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") || ""))
      return reply({ error: "unsupported_media_type" }, 415);
    const body = await readSmallJSON(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.url !== "string" || Object.keys(body).some(key => key !== "url"))
      return reply({ error: "invalid_request" }, 400);
    const plan = planBrowserTask({ url: body.url }, { ownHost: env.STAGING_BROWSER_OWN_HOST || "" });
    if (!plan.ok) return reply({ error: plan.code }, 400);
    if (plan.plan.hostname !== String(env.STAGING_BROWSER_PILOT_HOST || "").trim().toLowerCase())
      return reply({ error: "outside_pilot_hostname" }, 403);
    const token = makeToken();
    const reserved = await reserveStagingBrowserSlot(env, { token, now: clock() });
    if (!reserved.ok) return reply({ error: reserved.code }, reserved.code === "browser_busy" ? 429 : 503);
    try {
      const result = await executeStagingBrowserRead(plan.plan.url, env, { launch });
      if (!result.ok) return reply({ error: result.code, browserAttempted: true }, 422);
      return reply({
        ...result,
        stagingOnly: true,
        // This is reserved *staging* time, not actual Cloudflare invoice usage.
        remainingReservedBudgetSeconds: reserved.remainingSeconds
      });
    } finally {
      await releaseStagingBrowserSlot(env, token);
    }
  };
}

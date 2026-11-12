import { createVerifiedLinkFetcher } from "../../../src/verified-egress.js";
import { safeProbeError } from "./probe-client.mjs";

export async function verifyProxyDenials(env) {
  const token = env.EGRESS_PROXY_TOKEN;
  const request = async (url, auth) => env.EGRESS_PROXY.fetch("http://egress.internal/fetch", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ url })
  });
  for (const auth of [null, `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`]) {
    const response = await request("https://example.com/", auth);
    await response.body?.cancel();
    if (response.status !== 401) throw Object.assign(Error("authentication_denial_failed"), { proxyStatus: response.status });
  }
  for (const [url, error] of [
    ["http://127.0.0.1/", "unsafe_ip_literal"],
    ["https://[::1]/", "invalid_hostname"],
    ["http://169.254.169.254/", "unsafe_ip_literal"]
  ]) {
    const response = await request(url, token);
    if (response.status !== 502 || (await response.json()).error !== error) throw Object.assign(Error("unsafe_destination_denial_failed"), { proxyStatus: response.status });
  }
}

export async function runProof(env) {
  await verifyProxyDenials(env);
  // Exercise exactly the production adapter, with synthetic input and an isolated opt-in.
  let proxyStatus = null;
  const binding = { async fetch(...args) {
    const response = await env.EGRESS_PROXY.fetch(...args);
    proxyStatus = response.status;
    return response;
  } };
  const fetcher = createVerifiedLinkFetcher({ ...env, EGRESS_PROXY: binding, URL_READER_ENABLED: "true" });
  if (!fetcher) throw Error("adapter_unavailable");
  let response;
  try { response = await fetcher("https://example.com/", { signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw Object.assign(error, { proxyStatus }); }
  if (response.status !== 200) throw Error("synthetic_origin_failed");
  const body = await response.text();
  if (!body.includes("Example Domain")) throw Error("synthetic_content_failed");
  return { authenticationDenied: true, unsafeDestinationsDenied: true, productionAdapterPeerAndTlsVerified: true };
}

export default {
  async fetch(request, env) {
    // No arbitrary target, request body, URL, debug output or proxy response is exposed.
    if (request.method !== "POST" || new URL(request.url).pathname !== "/run") return new Response(null, { status: 404 });
    if (typeof env.EGRESS_PROXY_TOKEN !== "string" || env.EGRESS_PROXY_TOKEN.length < 32) return new Response(null, { status: 503 });
    const supplied = new TextEncoder().encode(request.headers.get("authorization") || "");
    const expected = new TextEncoder().encode(`Bearer ${env.EGRESS_PROXY_TOKEN}`);
    if (supplied.length !== expected.length || !crypto.subtle.timingSafeEqual(supplied, expected)) return new Response(null, { status: 401 });
    try {
      return Response.json({ ok: true, checks: await runProof(env) }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return Response.json({ ok: false, error: "runtime_proof_failed", diagnostic: safeProbeError(error) }, { status: 502, headers: { "cache-control": "no-store" } });
    }
  }
};

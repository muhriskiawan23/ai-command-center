import { createVerifiedLinkFetcher } from "../../../src/verified-egress.js";
import { readLink } from "../../../src/links.js";

export const FIXTURE_TEXT = "BOR AI synthetic public fixture. This contains no user data and exists only for a bounded security test.";
export async function fixtureResponse(request) {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" || !path.startsWith("/fixture/")) return null;
  const headers = { "cache-control": "no-store, no-transform", "content-type": "text/plain; charset=utf-8" };
  if (path === "/fixture/public") return new Response(FIXTURE_TEXT, { headers });
  if (path === "/fixture/redirect") return new Response(null, { status: 302, headers: { ...headers, location: "http://127.0.0.1/" } });
  if (path === "/fixture/large") return new Response("x".repeat(1_000_001), { headers: { ...headers, "content-type": "application/octet-stream" } });
  if (path === "/fixture/slow") {
    await new Promise(resolve => setTimeout(resolve, 12000));
    return new Response(FIXTURE_TEXT, { headers });
  }
  return new Response(null, { status: 404 });
}

function check(value, code) { if (!value) throw Error(code); }
export async function runExtendedProof(env) {
  const base = new URL(env.FIXTURE_ORIGIN);
  check(base.protocol === "https:" && /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(base.hostname) && base.pathname === "/" && !base.search && !base.hash && !base.username && !base.password && !base.port, "fixture_origin_invalid");
  const fetcher = createVerifiedLinkFetcher({ ...env, URL_READER_ENABLED: "true" });
  check(fetcher, "adapter_unavailable");
  const request = url => env.EGRESS_PROXY.fetch("http://egress.internal/fetch", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json", authorization: `Bearer ${env.EGRESS_PROXY_TOKEN}` },
    body: JSON.stringify({ url })
  });
  // A successful control is required, so a generic network outage cannot pass negative tests.
  const control = await fetcher(new URL("/fixture/public", base).href, { signal: AbortSignal.timeout(15000) });
  check(control.status === 200 && await control.text() === FIXTURE_TEXT, "controlled_origin_failed");
  for (const [url, reason, code] of [
    ["https://expired.badssl.com/", /^certificate has expired$/i, "expired_certificate_not_denied"],
    ["https://wrong.host.badssl.com/", /^Hostname\/IP does not match certificate/i, "wrong_host_certificate_not_denied"],
    ["https://self-signed.badssl.com/", /^self.signed certificate$/i, "self_signed_certificate_not_denied"]
  ]) {
    const response = await request(url);
    const body = await response.json().catch(() => null);
    check(response.status === 502 && typeof body?.error === "string" && reason.test(body.error), code);
  }
  let hops = 0;
  const redirect = await readLink(new URL("/fixture/redirect", base).href, {
    fetcher: (...args) => { hops++; return fetcher(...args); }
  });
  check(redirect.ok === false && redirect.reason.startsWith("pengalihan ke alamat yang tidak diizinkan") && hops === 1, "private_redirect_not_denied");
  for (const [path, expected, code] of [
    ["/fixture/large", "response_too_large", "response_limit_not_denied"],
    ["/fixture/slow", "request_timeout", "request_timeout_not_denied"]
  ]) {
    const response = await request(new URL(path, base).href);
    const body = await response.json().catch(() => null);
    check(response.status === 502 && body?.error === expected, code);
  }
  const started = Date.now();
  const aborted = await readLink(new URL("/fixture/slow", base).href, { fetcher, timeoutMs: 250 });
  check(aborted.ok === false && aborted.reason.startsWith("waktu habis") && Date.now() - started < 5000, "caller_abort_not_bounded");
  return { controlledOriginVerified: true, expiredTlsDenied: true, wrongHostTlsDenied: true,
    selfSignedTlsDenied: true, privateRedirectDenied: true, responseLimitDenied: true,
    proxyTimeoutDenied: true, callerAbortBounded: true };
}

import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedLinkFetcher } from "../src/verified-egress.js";

const token = "a".repeat(48);
function fakeEnv(handler) {
  return { URL_READER_ENABLED: "true", EGRESS_PROXY_TOKEN: token, EGRESS_PROXY: { fetch: handler } };
}
function payload(overrides = {}) {
  return { status: 200, headers: { "content-type": "text/plain" },
    bodyBase64: btoa("This is a public page with enough text for the reader."),
    peerIp: "93.184.215.14",
    transport: { selectedPeerIp: "93.184.215.14", observedPeerIp: "93.184.215.14",
      peerIpVerified: true, tlsAuthorized: true, tlsIdentityVerified: true,
      tlsServername: "example.com" }, ...overrides };
}
test("reader remains off without private binding and token", () => {
  assert.equal(createVerifiedLinkFetcher({}), null);
  assert.equal(createVerifiedLinkFetcher({ EGRESS_PROXY: { fetch() {} } }), null);
});
test("private adapter sends authenticated single-hop request and verifies TLS peer", async () => {
  let count = 0;
  const fetcher = createVerifiedLinkFetcher(fakeEnv(async (url, opts) => {
    count++;
    assert.equal(url, "http://egress.internal/fetch");
    assert.equal(opts.headers.authorization, `Bearer ${token}`);
    assert.equal(opts.redirect, "manual");
    assert.equal(JSON.parse(opts.body).url, "https://example.com/");
    return new Response(JSON.stringify(payload()), { status: 200 });
  }));
  const response = await fetcher("https://example.com/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /public page/);
  assert.equal(count, 1);
});
test("missing, mismatched and unverified transport evidence fail closed", async () => {
  for (const data of [
    payload({ transport: null }),
    payload({ transport: { ...payload().transport, observedPeerIp: "127.0.0.1" } }),
    payload({ transport: { ...payload().transport, tlsAuthorized: false } }),
    payload({ transport: { ...payload().transport, tlsServername: "wrong.example" } }),
    payload({ bodyBase64: "bad?" })
  ]) {
    const fetcher = createVerifiedLinkFetcher(fakeEnv(async () =>
      new Response(JSON.stringify(data), { status: 200 })));
    await assert.rejects(() => fetcher("https://example.com/"));
  }
});
test("proxy 401 and 502 never fall back to global fetch", async () => {
  for (const status of [401, 502]) {
    const fetcher = createVerifiedLinkFetcher(fakeEnv(async () => new Response("", { status })));
    await assert.rejects(() => fetcher("https://example.com/"), /proxy_unavailable/);
  }
});

test("the private adapter cancels a streaming proxy envelope above its byte limit", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(750_000).fill(32);
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { cancelled = true; }
  });
  const fetcher = createVerifiedLinkFetcher(fakeEnv(async () => new Response(body)));

  await assert.rejects(() => fetcher("https://example.com/"), /proxy_response_too_large/);
  assert.equal(cancelled, true);
});

test("configured credentials do not activate reader without explicit opt-in", () => {
  for (const value of [undefined, false, true, "false", "TRUE", "1"]) {
    const env = fakeEnv(() => { throw Error("must not contact proxy"); });
    env.URL_READER_ENABLED = value;
    assert.equal(createVerifiedLinkFetcher(env), null);
  }
});

test("unsafe URL never reaches the private egress binding even when called directly", async () => {
  let calls = 0;
  const fetcher = createVerifiedLinkFetcher(fakeEnv(async () => {
    calls++;
    return new Response(JSON.stringify(payload()));
  }));
  for (const url of [
    "http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data/",
    "http://localhost/", "https://[::1]/", "https://example.com:8443/",
    "https://user:pass@example.com/", "file:///etc/passwd", "http://singlelabel/"
  ]) {
    await assert.rejects(() => fetcher(url), /proxy_url_disallowed/, url);
  }
  assert.equal(calls, 0);
});
test("private or invented peer IPs are rejected even when a proxy reports verified transport", async () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "192.168.1.1",
    "8.8.8.999", "8.8.8.01", "256.8.8.8", "8.8.8.256", "1.2.3.4.5",
    "::1", "fe80::1", "::ffff:127.0.0.1", "example.com"]) {
    const data = payload({ peerIp: ip, transport: {
      ...payload().transport, selectedPeerIp: ip, observedPeerIp: ip
    } });
    const fetcher = createVerifiedLinkFetcher(fakeEnv(async () =>
      new Response(JSON.stringify(data), {status: 200})));
    await assert.rejects(() => fetcher("https://example.com/"), /proxy_security_proof_missing/, ip);
  }
});

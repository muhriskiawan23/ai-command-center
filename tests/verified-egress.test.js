import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedLinkFetcher } from "../src/verified-egress.js";

const token = "a".repeat(48);
function fakeEnv(handler) {
  return { EGRESS_PROXY_TOKEN: token, EGRESS_PROXY: { fetch: handler } };
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

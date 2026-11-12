import test from "node:test";
import assert from "node:assert/strict";
import { runProof } from "../tools/egress-proxy/runtime/probe-worker.js";
const token = "a".repeat(48);
function environment(overrides = {}) {
  return { EGRESS_PROXY_TOKEN: token, EGRESS_PROXY: { async fetch(url, options) {
    assert.equal(url, "http://egress.internal/fetch");
    const target = JSON.parse(options.body).url;
    if (options.headers.authorization !== `Bearer ${token}`) return new Response(null, { status: 401 });
    if (target !== "https://example.com/") return Response.json({ error: "unsafe_ip_literal" }, { status: 502 });
    return Response.json({ status: 200, peerIp: "93.184.215.14", bodyBase64: btoa("Example Domain"), headers: {},
      transport: { selectedPeerIp: "93.184.215.14", observedPeerIp: "93.184.215.14", peerIpVerified: true,
        tlsAuthorized: true, tlsIdentityVerified: true, tlsServername: "example.com", ...overrides } });
  } } };
}
test("fixed synthetic runtime probe verifies denial and production adapter proof", async () => {
  assert.deepEqual(await runProof(environment()), { authenticationDenied: true, unsafeDestinationsDenied: true, productionAdapterPeerAndTlsVerified: true });
});
test("runtime probe rejects peer mismatch and invalid TLS identity", async () => {
  for (const bad of [{ observedPeerIp: "127.0.0.1" }, { tlsIdentityVerified: false }]) {
    await assert.rejects(runProof(environment(bad)), /proxy_security_proof_missing/);
  }
});
test("runtime probe rejects proxy that permits unauthenticated requests", async () => {
  await assert.rejects(runProof({ EGRESS_PROXY_TOKEN: token, EGRESS_PROXY: { fetch: async () => new Response(null, { status: 200 }) } }), /authentication_denial_failed/);
});

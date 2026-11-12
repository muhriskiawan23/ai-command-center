import assert from "node:assert/strict";

const baseUrl = new URL(process.env.EGRESS_PROXY_BASE_URL || "");
const token = process.env.EGRESS_PROXY_TOKEN || "";
assert.equal(baseUrl.protocol, "https:", "hosted proof requires HTTPS ingress");
assert.equal(baseUrl.username, "", "base URL credentials are forbidden");
assert.equal(baseUrl.password, "", "base URL credentials are forbidden");
assert.equal(baseUrl.port, "", "custom ingress ports are forbidden");
assert.equal(baseUrl.pathname, "/", "base URL path must be root");
assert.equal(baseUrl.search, "", "base URL query is forbidden");
assert.equal(baseUrl.hash, "", "base URL fragment is forbidden");
assert.ok(token.length >= 32, "EGRESS_PROXY_TOKEN must be at least 32 characters");

const endpoint = new URL("/fetch", baseUrl);
const syntheticRequest = JSON.stringify({ url: "https://example.com/" });
const common = {
  method: "POST",
  redirect: "error",
  headers: { "content-type": "application/json" },
  body: syntheticRequest
};
const hostedFetch = (options) => fetch(endpoint, {
  ...options,
  signal: AbortSignal.timeout(90_000)
});

const denied = await hostedFetch(common);
assert.equal(denied.status, 401, "hosted proxy must deny missing authentication");

const wrongToken = `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`;
const wrongAuth = await hostedFetch({
  ...common,
  headers: { ...common.headers, authorization: `Bearer ${wrongToken}` }
});
assert.equal(wrongAuth.status, 401, "hosted proxy must deny incorrect authentication");

for (const [name, url, expectedError] of [
  ["IPv4 loopback", "http://127.0.0.1/", "unsafe_ip_literal"],
  ["IPv6 loopback", "https://[::1]/", "invalid_hostname"],
  ["cloud metadata", "http://169.254.169.254/", "unsafe_ip_literal"]
]) {
  const rejected = await hostedFetch({
    ...common,
    headers: { ...common.headers, authorization: `Bearer ${token}` },
    body: JSON.stringify({ url })
  });
  assert.equal(rejected.status, 502, `hosted proxy must reject ${name}`);
  assert.deepEqual(await rejected.json(), { error: expectedError });
}

const response = await hostedFetch({
  ...common,
  headers: { ...common.headers, authorization: `Bearer ${token}` }
});
assert.equal(response.status, 200, "authenticated synthetic request must reach the proxy");
const payload = await response.json();
assert.equal(payload.redirect, false);
assert.ok(payload.status >= 200 && payload.status < 400, "synthetic origin must return success");
assert.equal(payload.transport?.selectedPeerIp, payload.transport?.observedPeerIp);
assert.equal(payload.transport?.peerIpVerified, true);
assert.equal(payload.transport?.protocol, "tls");
assert.equal(payload.transport?.tlsServername, "example.com");
assert.equal(payload.transport?.tlsAuthorized, true);
assert.equal(payload.transport?.tlsIdentityVerified, true);

const {
  selectedPeerIp,
  observedPeerIp,
  tlsServername
} = payload.transport;
const upstreamStatusClass = `${Math.floor(payload.status / 100)}xx`;
console.log(JSON.stringify({
  result: "pass",
  selectedPeerIp,
  observedPeerIp,
  peerIpVerified: true,
  tlsServername,
  tlsAuthorized: true,
  tlsIdentityVerified: true,
  wrongAuthDenied: true,
  loopbackAndMetadataRejected: true,
  upstreamStatusClass
}));

// Fail-closed Worker adapter for a dedicated, authenticated, pinned egress proxy.
// Bind EGRESS_PROXY to a private Cloudflare VPC Service after security review.
// Never substitute global fetch or an arbitrary public endpoint.
const MAX_BODY_BASE64 = 1_400_000;
function decodeBase64(value) {
  if (typeof value !== "string" || value.length > MAX_BODY_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error("invalid_proxy_body");
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function createVerifiedLinkFetcher(env) {
  const binding = env?.EGRESS_PROXY;
  const token = env?.EGRESS_PROXY_TOKEN;
  if (!binding || typeof binding.fetch !== "function" || typeof token !== "string" || token.length < 32) return null;
  return async (url, { signal } = {}) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw Error("invalid_scheme");
    const response = await binding.fetch("http://egress.internal/fetch", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: parsed.toString() }),
      redirect: "manual",
      signal
    });
    if (!response.ok) throw Error("proxy_unavailable");
    const data = await response.json();
    if (!data || !Number.isInteger(data.status) || data.status < 100 || data.status > 599 ||
        typeof data.peerIp !== "string" || !data.transport ||
        data.transport.peerIpVerified !== true ||
        data.transport.selectedPeerIp !== data.transport.observedPeerIp ||
        data.transport.selectedPeerIp !== data.peerIp ||
        (parsed.protocol === "https:" &&
          (data.transport.tlsAuthorized !== true || data.transport.tlsIdentityVerified !== true ||
           data.transport.tlsServername !== parsed.hostname))) throw Error("proxy_security_proof_missing");
    const bytes = decodeBase64(data.bodyBase64);
    if (bytes.length > 1_000_000) throw Error("proxy_body_too_large");
    const headers = new Headers();
    for (const key of ["content-type", "location"]) {
      if (typeof data.headers?.[key] === "string") headers.set(key, data.headers[key]);
    }
    return new Response(bytes, { status: data.status, headers });
  };
}

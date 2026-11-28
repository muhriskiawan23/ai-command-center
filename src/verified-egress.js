import { blockedHostReason, validateUrl } from './links.js';

// Fail-closed Worker adapter for a dedicated, authenticated, pinned egress proxy.
// Bind EGRESS_PROXY to a private Cloudflare VPC Service after security review.
// Never substitute global fetch or an arbitrary public endpoint.
const MAX_BODY_BASE64 = 1_400_000;
const MAX_PROXY_RESPONSE_BYTES = MAX_BODY_BASE64 + 64 * 1024;

async function readProxyResponse(response) {
  if (!response.body) throw Error("invalid_proxy_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROXY_RESPONSE_BYTES) throw Error("proxy_response_too_large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length > MAX_BODY_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error("invalid_proxy_body");
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// Defense in depth: the proxy must pin and verify its TCP/TLS peer, while
// the Worker independently rejects private and malformed reported peer IPs.
function publicPeerIp(ip) {
  if (typeof ip !== 'string') return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return blockedHostReason(ip) === null;
  if (/^[0-9a-f:.]+$/i.test(ip) && ip.includes(':') && !ip.includes('.'))
    return blockedHostReason('[' + ip + ']') === null;
  return false;
}

export function createVerifiedLinkFetcher(env) {
  // Provisioning credentials must never implicitly activate production URL reading.
  if (env?.URL_READER_ENABLED !== "true") return null;
  const binding = env?.EGRESS_PROXY;
  const token = env?.EGRESS_PROXY_TOKEN;
  if (!binding || typeof binding.fetch !== "function" || typeof token !== "string" || token.length < 32) return null;
  return async (url, { signal } = {}) => {
    // This adapter can be called outside readLink. Never assume callers have
    // performed its URL validation before transferring a URL to the proxy.
    const checked = validateUrl(url);
    if (!checked.ok) throw Error("proxy_url_disallowed");
    const parsed = checked.url;
    const response = await binding.fetch("http://egress.internal/fetch", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: parsed.toString() }),
      redirect: "manual",
      signal
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      // Only explicit temporary capacity/gateway errors are fallback-eligible.
      // 502 may encode a rejected DNS/TLS/SSRF check; never downgrade it.
      const error = Error("proxy_unavailable");
      if ([429, 503, 504].includes(response.status)) error.code = "EGRESS_TEMPORARY_UNAVAILABLE";
      throw error;
    }
    const data = await readProxyResponse(response);
    if (!data || !Number.isInteger(data.status) || data.status < 100 || data.status > 599 ||
        !publicPeerIp(data.peerIp) || !data.transport ||
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

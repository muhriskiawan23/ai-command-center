import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { timingSafeEqual } from "node:crypto";

export const MAX_RESPONSE_BYTES = 1_000_000;
export const MAX_REQUEST_BYTES = 16_384;
export const DNS_CNAME_LIMIT = 8;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
];
const BLOCKED_V6 = [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["3fff::", 20], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
];

function ipv4Number(value) {
  if (net.isIP(value) !== 4) return null;
  return value.split(".").reduce((n, part) => (n << 8n) | BigInt(part), 0n);
}
function ipv6Number(value) {
  if (net.isIP(value) !== 6) return null;
  let input = value.toLowerCase();
  if (input.includes(".")) return null; // mapped/embedded IPv4 is conservatively rejected
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8) return null;
  return groups.reduce((n, group) => (n << 16n) | BigInt(parseInt(group, 16)), 0n);
}
function inCidr(value, base, bits, width) {
  const shift = BigInt(width - bits);
  return (value >> shift) === (base >> shift);
}
function cidrBase(address, family) {
  return family === 4 ? ipv4Number(address) : ipv6Number(address);
}
function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return !BLOCKED_V4.some(([base, bits]) => inCidr(value, ipv4Number(base), bits, 32));
  }
  if (family === 6) {
    const value = ipv6Number(address);
    if (value === null) return false;
    const globalUnicast = inCidr(value, ipv6Number("2000::"), 3, 128);
    return globalUnicast && !BLOCKED_V6.some(([base, bits]) => inCidr(value, cidrBase(base, 6), bits, 128));
  }
  return false;
}
export { isPublicAddress };

const NO_CNAME = new Set(["ENODATA", "ENOTIMP"]);
async function resolveChain(hostname, resolver = dns) {
  let current = hostname;
  const seen = new Set();
  for (let depth = 0; depth <= DNS_CNAME_LIMIT; depth++) {
    const key = current.toLowerCase().replace(/\.$/, "");
    if (seen.has(key)) throw new Error("dns_cname_loop");
    seen.add(key);
    let aliases = [];
    try { aliases = await resolver.resolveCname(current); }
    catch (error) { if (!NO_CNAME.has(error.code)) throw new Error("dns_cname_error"); }
    if (!aliases.length) break;
    if (depth === DNS_CNAME_LIMIT) throw new Error("dns_cname_depth");
    if (aliases.length !== 1) throw new Error("dns_ambiguous_cname");
    current = aliases[0].replace(/\.$/, "");
  }
  const [v4, v6] = await Promise.all([
    resolver.resolve4(current).catch((e) => { if (e.code === "ENODATA") return []; throw new Error("dns_a_error"); }),
    resolver.resolve6(current).catch((e) => { if (e.code === "ENODATA") return []; throw new Error("dns_aaaa_error"); })
  ]);
  const addresses = [...new Set([...v4, ...v6])];
  if (!addresses.length || addresses.some((ip) => !isPublicAddress(ip))) throw new Error("dns_unsafe_or_empty");
  return addresses;
}
export { resolveChain };

function normalizePeer(value) {
  if (!value) return "";
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}
function validateTarget(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("invalid_url"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported_scheme");
  if (url.username || url.password || url.port) throw new Error("credentials_or_port_rejected");
  if (!url.hostname || url.hostname.endsWith(".") === false && !url.hostname.includes(".")) throw new Error("invalid_hostname");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const family = net.isIP(host);
  if (family && !isPublicAddress(host)) throw new Error("unsafe_ip_literal");
  if (!family && (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp|intranet|home\.arpa)$/.test(host))) throw new Error("internal_hostname");
  return { url, host, family };
}

/** @internal Low-level socket primitive. Callers must validate DNS and target policy first. */
export function requestOneHop({ url, host, family, peerIp, timeoutMs, maxBytes, tlsCa, port }) {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const transport = secure ? https : http;
    const options = {
      protocol: url.protocol,
      hostname: host,
      port: port ?? (secure ? 443 : 80),
      method: "GET",
      path: url.pathname + url.search,
      agent: false,
      headers: {
        Host: url.host,
        "User-Agent": "BOR-AI-Egress-Prototype/0.1",
        Accept: "text/html,application/xhtml+xml,text/plain,application/json"
      },
      ...(family ? {} : {
        lookup: (_hostname, _options, callback) => callback(null, peerIp, net.isIP(peerIp))
      }),
      ...(secure && !family ? { servername: host, rejectUnauthorized: true } : {}),
      ...(secure && tlsCa ? { ca: tlsCa } : {})
    };
    const req = transport.request(options, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({
        status: res.statusCode || 502,
        headers: {
          "content-type": res.headers["content-type"] || "application/octet-stream",
          ...(res.headers.location ? { location: res.headers.location } : {})
        },
        body: Buffer.concat(chunks)
      }));
      res.on("error", reject);
    });
    const verifyPeer = (socket) => {
      const actual = normalizePeer(socket.remoteAddress);
      if (actual !== normalizePeer(peerIp)) req.destroy(new Error("peer_ip_mismatch"));
      if (secure && !family && socket.servername !== host) req.destroy(new Error("tls_sni_mismatch"));
      if (secure && !family) {
        const cert = socket.getPeerCertificate?.();
        const identityError = cert && tls.checkServerIdentity(host, cert);
        if (identityError) req.destroy(new Error("tls_identity_mismatch"));
      }
    };
    req.on("socket", (socket) => {
      if (secure) socket.once("secureConnect", () => verifyPeer(socket));
      else socket.once("connect", () => verifyPeer(socket));
    });
    const totalTimer = setTimeout(() => req.destroy(new Error("request_timeout")), timeoutMs);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("request_timeout")));
    req.on("close", () => clearTimeout(totalTimer));
    req.on("error", (error) => reject(error));
    req.end();
  });
}

export async function fetchPinned(rawUrl, {
  resolver = dns,
  timeoutMs = 8000,
  maxBytes = MAX_RESPONSE_BYTES,
  request = requestOneHop
} = {}) {
  const { url, host, family } = validateTarget(rawUrl);
  const addresses = family ? [host] : await resolveChain(host, resolver);
  const peerIp = addresses[0];
  const result = await request({ url, host, family, peerIp, timeoutMs, maxBytes });
  if (REDIRECTS.has(result.status)) return { ...result, body: Buffer.alloc(0), peerIp, redirect: true };
  return { ...result, peerIp, redirect: false };
}

/**
 * Minimal single-hop proxy handler. Mount behind a private authenticated ingress;
 * never expose this handler as an unauthenticated public proxy.
 * Request: POST /fetch with {"url":"https://public.example/path"}.
 * Response body is base64 so a Worker adapter can reconstruct the upstream bytes.
 */
export function createEgressProxyHandler({ token, resolver = dns, timeoutMs = 8000 } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("proxy_token_must_be_at_least_32_chars");
  return async function handler(req, res) {
    if (req.method !== "POST" || req.url !== "/fetch") {
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization || "";
    const expected = Buffer.from("Bearer " + token);
    const supplied = Buffer.from(auth);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      res.writeHead(401).end();
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { res.writeHead(400).end(); return; }
    if (typeof input.url !== "string" || input.url.length > 4096) {
      res.writeHead(400).end();
      return;
    }
    try {
      const result = await fetchPinned(input.url, { resolver, timeoutMs });
      const payload = JSON.stringify({
        status: result.status,
        headers: result.headers,
        bodyBase64: result.body.toString("base64"),
        peerIp: result.peerIp,
        redirect: result.redirect
      });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(payload);
    } catch (error) {
      const reason = String(error?.message || "egress_failed").slice(0, 80);
      res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ error: reason }));
    }
  };
}

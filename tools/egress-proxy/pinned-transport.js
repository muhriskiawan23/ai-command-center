import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { timingSafeEqual } from "node:crypto";

export const MAX_RESPONSE_BYTES = 1_000_000;
export const MAX_REQUEST_BYTES = 16_384;
export const MAX_CONCURRENT_REQUESTS = 4;
export const DNS_CNAME_LIMIT = 8;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.175.48.0", 24],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
];
const BLOCKED_V6 = [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["3fff::", 20], ["2620:4f:8000::", 48], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
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

const NO_CNAME = new Set(["ENODATA"]);

function awaitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new Error("request_aborted"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason || new Error("request_aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}
async function resolveChain(hostname, resolver = dns, options = {}) {
  const signal = options.signal;
  let current = hostname;
  const seen = new Set();
  for (let depth = 0; depth <= DNS_CNAME_LIMIT; depth++) {
    const key = current.toLowerCase().replace(/\.$/, "");
    if (seen.has(key)) throw new Error("dns_cname_loop");
    seen.add(key);
    let aliases = [];
    try { aliases = await awaitWithSignal(resolver.resolveCname(current), signal); }
    catch (error) {
      if (signal?.aborted) throw signal.reason || new Error("request_aborted");
      if (!NO_CNAME.has(error.code)) throw new Error("dns_cname_error");
    }
    if (!aliases.length) break;
    if (depth === DNS_CNAME_LIMIT) throw new Error("dns_cname_depth");
    if (aliases.length !== 1) throw new Error("dns_ambiguous_cname");
    current = aliases[0].replace(/\.$/, "");
  }
  const [v4, v6] = await awaitWithSignal(Promise.all([
    resolver.resolve4(current).catch((e) => { if (e.code === "ENODATA") return []; throw new Error("dns_a_error"); }),
    resolver.resolve6(current).catch((e) => { if (e.code === "ENODATA") return []; throw new Error("dns_aaaa_error"); })
  ]), signal);
  const addresses = [...new Set([...v4, ...v6])];
  if (!addresses.length || addresses.some((ip) => !isPublicAddress(ip))) throw new Error("dns_unsafe_or_empty");
  return addresses;
}
export { resolveChain };

function normalizePeer(value) {
  if (!value) return "";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped) return normalizePeer(mapped[1]);
  const family = net.isIP(value);
  if (family === 4) return `4:${value.split(".").map(Number).join(".")}`;
  if (family === 6) {
    const numeric = ipv6Number(value);
    return numeric === null ? value.toLowerCase() : `6:${numeric.toString(16).padStart(32, "0")}`;
  }
  return value.toLowerCase();
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
export function requestOneHop({
  url, host, family, peerIp, timeoutMs = 8000,
  maxBytes = MAX_RESPONSE_BYTES, tlsCa, port, signal
}) {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const transport = secure ? https : http;
    let settled = false;
    let req;
    let totalTimer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (totalTimer) clearTimeout(totalTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const fail = (error) => {
      finish(error instanceof Error ? error : new Error("egress_request_failed"));
      if (req && !req.destroyed) req.destroy();
    };
    const onAbort = () => fail(new Error("request_aborted"));
    if (signal?.aborted) {
      finish(new Error("request_aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
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
        lookup: (_hostname, lookupOptions, callback) => {
          const addressFamily = net.isIP(peerIp);
          if (lookupOptions?.all) callback(null, [{ address: peerIp, family: addressFamily }]);
          else callback(null, peerIp, addressFamily);
        }
      }),
      ...(secure && !family ? { servername: host, rejectUnauthorized: true } : {}),
      ...(secure && tlsCa ? { ca: tlsCa } : {})
    };
    totalTimer = setTimeout(() => fail(new Error("request_timeout")), timeoutMs);
    req = transport.request(options, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) {
          const error = new Error("response_too_large");
          fail(error);
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        finish(null, {
          status: res.statusCode || 502,
          headers: {
            "content-type": res.headers["content-type"] || "application/octet-stream",
            ...(res.headers.location ? { location: res.headers.location } : {})
          },
          body: Buffer.concat(chunks)
        });
      });
      res.on("aborted", () => fail(new Error("response_aborted")));
      res.on("error", fail);
    });
    const verifyPeer = (socket) => {
      if (settled) return;
      const actual = normalizePeer(socket.remoteAddress);
      if (actual !== normalizePeer(peerIp)) {
        fail(new Error("peer_ip_mismatch"));
        return;
      }
      if (secure && !family && socket.servername !== host) {
        fail(new Error("tls_sni_mismatch"));
        return;
      }
      if (secure && !family) {
        const cert = socket.getPeerCertificate?.();
        const identityError = cert && tls.checkServerIdentity(host, cert);
        if (identityError) fail(new Error("tls_identity_mismatch"));
      }
    };
    req.on("socket", (socket) => {
      if (secure) socket.once("secureConnect", () => verifyPeer(socket));
      else socket.once("connect", () => verifyPeer(socket));
    });
    req.setTimeout(timeoutMs, () => fail(new Error("request_timeout")));
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      fail(new Error("protocol_upgrade_rejected"));
    });
    req.on("connect", (_res, socket) => {
      socket.destroy();
      fail(new Error("protocol_connect_rejected"));
    });
    req.on("error", fail);
    req.end();
  });
}

export async function fetchPinned(rawUrl, {
  resolver = dns,
  timeoutMs = 8000,
  maxBytes = MAX_RESPONSE_BYTES,
  request = requestOneHop,
  signal
} = {}) {
  const startedAt = Date.now();
  const { url, host, family } = validateTarget(rawUrl);
  let addresses;
  if (family) {
    addresses = [host];
  } else {
    const dnsDeadline = new AbortController();
    const dnsTimer = setTimeout(() => dnsDeadline.abort(new Error("dns_timeout")), timeoutMs);
    const dnsSignal = signal ? AbortSignal.any([signal, dnsDeadline.signal]) : dnsDeadline.signal;
    try {
      addresses = await resolveChain(host, resolver, { signal: dnsSignal });
    } finally {
      clearTimeout(dnsTimer);
    }
  }
  const peerIp = addresses[0];
  if (signal?.aborted) throw new Error("request_aborted");
  const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
  if (remainingTimeoutMs <= 0) throw new Error("request_timeout");
  const result = await request({ url, host, family, peerIp, timeoutMs: remainingTimeoutMs, maxBytes, signal });
  if (REDIRECTS.has(result.status)) return { ...result, body: Buffer.alloc(0), peerIp, redirect: true };
  return { ...result, peerIp, redirect: false };
}

/**
 * Minimal single-hop proxy handler. Mount behind a private authenticated ingress;
 * never expose this handler as an unauthenticated public proxy.
 * Request: POST /fetch with {"url":"https://public.example/path"}.
 * Response body is base64 so a Worker adapter can reconstruct the upstream bytes.
 */
export function createEgressProxyHandler({ token, resolver = dns, timeoutMs = 8000, request = requestOneHop, maxConcurrentRequests = MAX_CONCURRENT_REQUESTS } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("proxy_token_must_be_at_least_32_chars");
  if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1 || maxConcurrentRequests > 64) throw new Error("invalid_max_concurrent_requests");
  let activeRequests = 0;
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
    const bodyTimeoutMs = Math.min(Math.max(timeoutMs, 1000), 10000);
    let bodyTimer;
    let bodyError;
    const iterator = req[Symbol.asyncIterator]();
    try {
      const deadline = new Promise((_, reject) => {
        bodyTimer = setTimeout(() => reject(new Error("request_body_timeout")), bodyTimeoutMs);
      });
      while (true) {
        const next = await Promise.race([iterator.next(), deadline]);
        if (next.done) break;
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) {
          bodyError = "request_body_too_large";
          break;
        }
        chunks.push(chunk);
      }
    } catch (error) {
      bodyError = error?.message === "request_body_timeout" ? "request_body_timeout" : "request_body_aborted";
    } finally {
      if (bodyTimer) clearTimeout(bodyTimer);
      if (bodyError && typeof iterator.return === "function") {
        // Do not await iterator.return(): a stalled stream may never settle it.
        Promise.resolve(iterator.return()).catch(() => {});
      }
    }
    if (bodyError) {
      const status = bodyError === "request_body_too_large" ? 413 : 408;
      if (!req.aborted && !res.destroyed) {
        res.writeHead(status, { "cache-control": "no-store" }).end();
      }
      return;
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { res.writeHead(400, { "cache-control": "no-store" }).end(); return; }
    if (typeof input.url !== "string" || input.url.length > 4096) {
      res.writeHead(400).end();
      return;
    }
    if (activeRequests >= maxConcurrentRequests) {
      res.writeHead(429, { "cache-control": "no-store", "retry-after": "1" })
        .end(JSON.stringify({ error: "egress_busy" }));
      return;
    }
    activeRequests++;
    try {
      const controller = new AbortController();
      const onResponseClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on?.("close", onResponseClose);
      let result;
      try {
        result = await fetchPinned(input.url, { resolver, timeoutMs, request, signal: controller.signal });
      } finally {
        res.off?.("close", onResponseClose);
        res.removeListener?.("close", onResponseClose);
      }
      if (res.destroyed || res.writableEnded) return;
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
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" })
          .end(JSON.stringify({ error: reason }));
      }
    } finally {
      activeRequests--;
    }
  };
}

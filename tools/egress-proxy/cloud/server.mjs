import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createEgressProxyHandler } from "../pinned-transport.js";

const port = Number(process.env.PORT || 10000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid_port");
// Dedicated temporary credential; never overwrite the existing tunnel secret.
const token = process.env.EGRESS_SERVERLESS_QA_TOKEN;
const allowedUrls = new Set(["https://example.com/", "http://127.0.0.1/"]);
if (typeof token !== "string" || token.length < 32) throw new Error("missing_staging_token");
const expected = Buffer.from("Bearer " + token);
const handle = createEgressProxyHandler({token, maxConcurrentRequests: 2, allowedUrls});
let total = 0, minute = -1, windowCount = 0, inflight = 0;
const server = createServer({maxHeaderSize: 8192}, (req, res) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("connection", "close");
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {"content-type":"text/plain"}).end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/fetch") {
    res.writeHead(404).end(); return;
  }
  const supplied = Buffer.from(req.headers.authorization || "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    res.writeHead(401).end(); return;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    res.writeHead(415).end(); return;
  }
  const now = Math.floor(Date.now() / 60000);
  if (now !== minute) { minute = now; windowCount = 0; }
  if (total >= 100 || windowCount >= 20 || inflight >= 2) {
    res.writeHead(429, {"retry-after":"60"}).end(); return;
  }
  total++; windowCount++; inflight++;
  void handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
    else res.destroy();
  }).finally(() => { inflight--; });
});
server.headersTimeout = 5000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 1000;
server.maxConnections = 32;
server.maxRequestsPerSocket = 1;
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "0.0.0.0", resolve);
});
const base = "http://127.0.0.1:" + port;
async function probe(url, authenticated = true) {
  return fetch(base + "/fetch", {
    method: "POST",
    headers: {"content-type":"application/json", ...(authenticated ? {authorization: "Bearer " + token} : {})},
    body: JSON.stringify({url}), signal: AbortSignal.timeout(12000)
  });
}
try {
  const health = await fetch(base + "/health", {signal: AbortSignal.timeout(3000)});
  const denied = await probe("https://example.com/", false);
  const privateDenied = await probe("http://127.0.0.1/");
  const publicResult = await probe("https://example.com/");
  const privateBody = await privateDenied.json();
  const data = await publicResult.json();
  const checks = {
    health: health.status === 200,
    missingAuth: denied.status === 401,
    privateIPDenied: privateDenied.status === 502 && privateBody.error === "unsafe_ip_literal",
    publicHTTPS: publicResult.status === 200 && data.status === 200 && typeof data.bodyBase64 === "string" && Buffer.from(data.bodyBase64,"base64").length > 0 && data.transport?.peerIpVerified === true && data.transport?.tlsAuthorized === true && data.transport?.tlsIdentityVerified === true
  };
  console.log(JSON.stringify({stage:"serverless-startup-probe", checks}));
  if (!Object.values(checks).every(Boolean)) throw new Error("startup_probe_failed");
} catch {
  console.error("serverless_startup_probe_failed");
  process.exit(1);
}

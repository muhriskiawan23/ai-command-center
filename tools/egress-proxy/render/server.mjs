import { createServer } from "node:http";
import { createEgressProxyHandler } from "../pinned-transport.js";

const token = process.env.EGRESS_PROXY_TOKEN;
if (!token || token.length < 32) {
  throw new Error("EGRESS_PROXY_TOKEN must be configured (at least 32 characters)");
}
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("invalid PORT");
}
const fetchHandler = createEgressProxyHandler({ token });
const server = createServer((req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET" && req.url?.split("?", 1)[0] === "/health") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
    return;
  }
  // No URL echo, debug endpoints, test execution or unauthenticated fetching.
  void fetchHandler(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
    else res.destroy();
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, "0.0.0.0");

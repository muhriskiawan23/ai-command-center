import { createServer } from "node:http";
import { createEgressProxyHandler } from "../pinned-transport.js";

const healthPort = Number(process.env.PORT || 10000);
const originPort = 10001;
if (!Number.isSafeInteger(healthPort) || healthPort < 1 || healthPort > 65535 || healthPort === originPort) {
  throw new Error("Invalid public health port");
}

const handlePrivateFetch = createEgressProxyHandler({ token: process.env.EGRESS_PROXY_TOKEN });
const privateOrigin = createServer((request, response) => {
  response.setHeader("cache-control", "no-store");
  void handlePrivateFetch(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500).end();
    else response.destroy();
  });
});

const publicHealth = createServer((request, response) => {
  response.setHeader("cache-control", "no-store");
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
    return;
  }
  response.writeHead(404).end();
});

for (const server of [privateOrigin, publicHealth]) {
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
}

privateOrigin.listen(originPort, "127.0.0.1");
publicHealth.listen(healthPort, "0.0.0.0");

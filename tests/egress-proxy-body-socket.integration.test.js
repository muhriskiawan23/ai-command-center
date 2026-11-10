import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createEgressProxyHandler, MAX_REQUEST_BYTES } from "../tools/egress-proxy/pinned-transport.js";

async function startServer(t, timeoutMs = 1000) {
  const handler = createEgressProxyHandler({ token: "body-test-token-".padEnd(40, "x"), timeoutMs });
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

function post(server, { contentLength, body, leaveOpen = false }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      path: "/fetch",
      method: "POST",
      headers: {
        authorization: "Bearer " + "body-test-token-".padEnd(40, "x"),
        "content-type": "application/json",
        "content-length": contentLength
      }
    }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, connection: res.headers.connection }));
    });
    req.on("error", reject);
    if (body?.length) req.write(body);
    if (!leaveOpen) req.end();
  });
}

test("real HTTP handler returns 413 for oversized body and closes the connection cleanly", async (t) => {
  const server = await startServer(t);
  const response = await post(server, {
    contentLength: MAX_REQUEST_BYTES + 1,
    body: Buffer.alloc(MAX_REQUEST_BYTES + 1, 0x61)
  });
  assert.equal(response.status, 413);
  assert.equal(response.connection, "close");
});

test("real HTTP handler returns 408 for a stalled body instead of resetting the socket", async (t) => {
  const server = await startServer(t, 1000);
  const responsePromise = post(server, {
    contentLength: 100,
    body: Buffer.from('{"url":'),
    leaveOpen: true
  });
  const response = await responsePromise;
  assert.equal(response.status, 408);
  assert.equal(response.connection, "close");
});

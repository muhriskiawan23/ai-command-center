import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  fetchPinned,
  resolveChain,
  requestOneHop,
  createEgressProxyHandler,
  MAX_REQUEST_BYTES
} from "../tools/egress-proxy/pinned-transport.js";

const noData = () => Object.assign(new Error("no data"), { code: "ENODATA" });
const resolverFor = (ip) => ({
  resolveCname: async () => { throw noData(); },
  resolve4: async () => [ip],
  resolve6: async () => []
});
const socketArgs = (port, peerIp = "127.0.0.1") => ({
  url: new URL(`http://fixture.example:${port}/probe`),
  host: "fixture.example",
  family: 0,
  peerIp,
  port,
  timeoutMs: 1000,
  maxBytes: 4
});

test("CNAME depth overflow and empty terminal answers fail closed", async () => {
  const deep = {
    resolveCname: async (host) => {
      const n = Number(host.match(/^n(\d+)\.example$/)?.[1] ?? 0);
      return n < 9 ? [`n${n + 1}.example`] : Promise.reject(noData());
    },
    resolve4: async () => ["8.8.8.8"],
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("n0.example", deep), /dns_cname_depth/);
  const empty = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => { throw noData(); },
    resolve6: async () => { throw noData(); }
  };
  await assert.rejects(resolveChain("empty.example", empty), /dns_unsafe_or_empty/);
});

test("each fetch invocation resolves DNS again instead of reusing a prior pin", async () => {
  let lookups = 0;
  const resolver = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => [++lookups === 1 ? "8.8.8.8" : "1.1.1.1"],
    resolve6: async () => []
  };
  const peers = [];
  const request = async ({ peerIp }) => {
    peers.push(peerIp);
    return { status: 200, headers: {}, body: Buffer.from("ok") };
  };
  await fetchPinned("https://rotate.example/a", { resolver, request });
  await fetchPinned("https://rotate.example/b", { resolver, request });
  assert.deepEqual(peers, ["8.8.8.8", "1.1.1.1"]);
  assert.equal(lookups, 2);
});

test("actual socket response cap aborts an oversized upstream body", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("0123456789");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    requestOneHop(socketArgs(server.address().port)),
    /response_too_large/
  );
});

test("actual socket timeout aborts a stalled response", async (t) => {
  const server = http.createServer((_req, res) => {
    setTimeout(() => res.end("late"), 150);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    requestOneHop({ ...socketArgs(server.address().port), timeoutMs: 25 }),
    /request_timeout/
  );
});

test("IPv6 loopback socket uses and verifies the selected IPv6 peer when available", async (t) => {
  const server = http.createServer((_req, res) => res.end("v6"));
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "::1", resolve);
    });
  } catch {
    t.skip("IPv6 loopback is unavailable in this runner");
    return;
  }
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await requestOneHop(socketArgs(server.address().port, "::1"));
  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), "v6");
});

test("private handler rejects unauthorized requests before reading a body", async () => {
  const handler = createEgressProxyHandler({ token: "t".repeat(40) });
  let status;
  let ended = false;
  const req = {
    method: "POST",
    url: "/fetch",
    headers: { authorization: "Bearer wrong" },
    async *[Symbol.asyncIterator]() { throw new Error("body must not be read"); }
  };
  const res = {
    writeHead(code) { status = code; return this; },
    end() { ended = true; return this; }
  };
  await handler(req, res);
  assert.equal(status, 401);
  assert.equal(ended, true);
});

test("private handler rejects oversized request bodies", async () => {
  const handler = createEgressProxyHandler({ token: "t".repeat(40) });
  let status;
  let ended = false;
  const req = {
    method: "POST",
    url: "/fetch",
    headers: { authorization: "Bearer " + "t".repeat(40) },
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(MAX_REQUEST_BYTES + 1, 0x61);
    }
  };
  const res = {
    writeHead(code) { status = code; return this; },
    end() { ended = true; return this; }
  };
  await handler(req, res);
  assert.equal(status, 413);
  assert.equal(ended, true);
});


test("private handler bounds a stalled request body and returns 408", async () => {
  const handler = createEgressProxyHandler({ token: "t".repeat(40), timeoutMs: 1000 });
  let status;
  let ended = false;
  const req = {
    method: "POST", url: "/fetch", aborted: false,
    headers: { authorization: "Bearer " + "t".repeat(40) },
    async *[Symbol.asyncIterator]() { await new Promise(() => {}); }
  };
  const headers = {};
  const res = {
    destroyed: false,
    writeHead(code, value = {}) { status = code; Object.assign(headers, value); return this; },
    end() { ended = true; return this; }
  };
  await handler(req, res);
  assert.equal(status, 408);
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(ended, true);
});

test("private handler rejects malformed JSON and invalid target without upstream access", async () => {
  const handler = createEgressProxyHandler({
    token: "t".repeat(40),
    resolver: {
      resolveCname: async () => { throw noData(); },
      resolve4: async () => { throw noData(); },
      resolve6: async () => { throw noData(); }
    }
  });
  const invoke = async (body) => {
    let status;
    let headers = {};
    const req = {
      method: "POST", url: "/fetch",
      headers: { authorization: "Bearer " + "t".repeat(40) },
      async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
    };
    const res = {
      writeHead(code, value = {}) { status = code; headers = value; return this; },
      end() { return this; }
    };
    await handler(req, res);
    return { status, headers };
  };
  const malformed = await invoke("{");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers["cache-control"], "no-store");
  const invalid = await invoke(JSON.stringify({ url: "file:///etc/passwd" }));
  assert.equal(invalid.status, 502);
  assert.equal(invalid.headers["cache-control"], "no-store");
});

test("private handler rejects wrong route and method", async () => {
  const handler = createEgressProxyHandler({ token: "t".repeat(40) });
  for (const [method, url] of [["GET", "/fetch"], ["POST", "/other"]]) {
    let status;
    let ended = false;
    await handler(
      { method, url, headers: {} },
      { writeHead(code) { status = code; return this; }, end() { ended = true; return this; } }
    );
    assert.equal(status, 404);
    assert.equal(ended, true);
  }
});


test("actual upstream socket is destroyed when the caller aborts", async (t) => {
  let clientClosed = false;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("start");
    res.on("close", () => { clientClosed = true; });
    // Keep the response open until the client socket is destroyed.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const controller = new AbortController();
  const pending = requestOneHop({
    ...socketArgs(server.address().port),
    maxBytes: 100,
    timeoutMs: 2000,
    signal: controller.signal
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  controller.abort();
  await assert.rejects(pending, /request_aborted/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(clientClosed, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { requestOneHop } from "../tools/egress-proxy/pinned-transport.js";

const fixture = (protocol, port) => ({
  url: new URL(`${protocol}://fixture.example:${port}/probe`),
  host: "fixture.example",
  family: 0,
  peerIp: "127.0.0.1",
  port,
  timeoutMs: 3000,
  maxBytes: 128
});

test("HTTP socket integration pins the actual peer IP and preserves the original Host header", async (t) => {
  let observed;
  const server = http.createServer((req, res) => {
    observed = { host: req.headers.host, peer: req.socket.remoteAddress };
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await requestOneHop(fixture("http", server.address().port));
  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), "ok");
  assert.equal(observed.host, `fixture.example:${server.address().port}`);
  assert.equal(observed.peer, "127.0.0.1");
  assert.equal(result.headers["content-type"], "text/plain");
});

test("HTTPS integration pins the socket, sends original SNI, and validates the certificate identity", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bor-egress-tls-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "2",
    "-subj", "/CN=fixture.example",
    "-addext", "subjectAltName=DNS:fixture.example"
  ], { stdio: "ignore" });
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);
  let observed;
  const server = https.createServer({ key, cert }, (req, res) => {
    observed = {
      host: req.headers.host,
      peer: req.socket.remoteAddress,
      sni: req.socket.servername
    };
    res.writeHead(200, { "content-type": "text/plain" }).end("secure");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await requestOneHop({
    ...fixture("https", server.address().port),
    tlsCa: cert
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), "secure");
  assert.equal(observed.host, `fixture.example:${server.address().port}`);
  assert.equal(observed.peer, "127.0.0.1");
  assert.equal(observed.sni, "fixture.example");

  await assert.rejects(
    requestOneHop({
      ...fixture("https", server.address().port),
      host: "wrong.example",
      url: new URL(`https://wrong.example:${server.address().port}/probe`),
      tlsCa: cert
    }),
    /certificate|identity|hostname|altname/i
  );
});


test("IPv6 loopback socket verifies the actual peer when IPv6 is available", async (t) => {
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
  const port = server.address().port;
  const result = await requestOneHop({
    url: new URL(`http://[::1]:${port}/probe`),
    host: "::1",
    family: 6,
    peerIp: "::1",
    port,
    timeoutMs: 1000,
    maxBytes: 128
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), "v6");
});

test("runtime response-size cap aborts an oversized socket response", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("x".repeat(4096));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    requestOneHop({ ...fixture("http", server.address().port), maxBytes: 32 }),
    /response_too_large/
  );
});

test("total request timeout aborts a slow response", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    setTimeout(() => res.end("late"), 500);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    requestOneHop({ ...fixture("http", server.address().port), timeoutMs: 50 }),
    /request_timeout/
  );
});

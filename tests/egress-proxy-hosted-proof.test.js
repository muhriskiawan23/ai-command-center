import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("tools/egress-proxy/verify-hosted.mjs", "utf8");

test("hosted proof is fixed to synthetic HTTPS and emits no content", () => {
  assert.match(source, /https:\/\/example\.com\//);
  assert.match(source, /selectedPeerIp/);
  assert.match(source, /observedPeerIp/);
  assert.match(source, /tlsIdentityVerified/);
  assert.match(source, /incorrect authentication/);
  assert.match(source, /http:\/\/127\.0\.0\.1\//);
  assert.match(source, /https:\/\/\[::1\]\//);
  assert.match(source, /http:\/\/169\.254\.169\.254\//);
  assert.match(source, /unsafe_ip_literal/);
  assert.match(source, /AbortSignal\.timeout\(90_000\)/);
  assert.doesNotMatch(source, /bodyBase64/);
  assert.doesNotMatch(source, /console\.log\([^)]*payload/);
  assert.doesNotMatch(source, /process\.argv/);
});

test("Railway health endpoint accepts tracking query without changing fetch authorization", async (t) => {
  const { spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, ["tools/egress-proxy/render/server.mjs"], {
    env: { ...process.env, PORT: String(port), EGRESS_PROXY_TOKEN: "a".repeat(48) },
    stdio: "ignore"
  });
  t.after(() => { child.kill(); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/health?utm_source=chatgpt.com`, { signal: AbortSignal.timeout(1000) });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "ok");
      ready = true;
      break;
    } catch (err) {
      if (err?.name === "AssertionError") throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, "proxy must start and serve query-bearing health checks");
  const denied = await fetch(`${base}/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/" }),
    signal: AbortSignal.timeout(2000)
  });
  assert.equal(denied.status, 401, "healthcheck fix must not bypass fetch authorization");
});

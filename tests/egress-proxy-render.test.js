import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

async function unusedPort() {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}

test("Render entrypoint refuses to boot without a secret", async () => {
  const child = spawn(process.execPath, ["tools/egress-proxy/render/server.mjs"], {
    env: { ...process.env, EGRESS_PROXY_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (b) => { stderr += b.toString(); });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /EGRESS_PROXY_TOKEN/);
});

test("Render entrypoint exposes health but denies unauthenticated fetch", async () => {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["tools/egress-proxy/render/server.mjs"], {
    env: { ...process.env, PORT: String(port), EGRESS_PROXY_TOKEN: "test-secret-not-for-production-123456789" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    let health;
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error("server exited early");
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(health?.status, 200);
    const denied = await fetch(`http://127.0.0.1:${port}/fetch`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/" })
    });
    assert.equal(denied.status, 401);
    const missing = await fetch(`http://127.0.0.1:${port}/debug`);
    assert.equal(missing.status, 404);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

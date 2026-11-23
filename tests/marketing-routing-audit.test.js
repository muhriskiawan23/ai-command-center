import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../scripts/audit-cloudflare-marketing-routing.mjs", import.meta.url));
const source = readFileSync(file, "utf8");

test("manual marketing Cloudflare audit parses with Node without executing API requests", () => {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Cloudflare routing audit is read-only, has strict timeout, and fails closed on missing proof", () => {
  assert.match(source, /method: "GET"/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /AbortSignal\.timeout\(20000\)/);
  assert.match(source, /if \(!complete\) process\.exitCode = 1/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/);
  assert.match(source, /response body logged/);
  for (const endpoint of ["/dns_records", "/workers/routes", "/workers/domains", "/pages/projects"]) {
    assert.ok(source.includes(endpoint), endpoint);
  }
});

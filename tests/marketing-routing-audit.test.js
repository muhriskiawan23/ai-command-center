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
  for (const endpoint of ["/dns_records", "/workers/routes", "/workers/domains", "/pages/projects"]) {
    assert.ok(source.includes(endpoint), endpoint);
  }
});

test("Pages audit requests the bare endpoint and reports only numeric error codes on failure", () => {
  const fixture = `
    globalThis.fetch = async (url, options) => {
      const { pathname, search } = new URL(url);
      if (options.method !== "GET") throw new Error("Unexpected method");
      if (pathname === "/client/v4/accounts/test-account/pages/projects") {
        if (search) throw new Error("Unexpected Pages query");
        return Response.json({ errors: [
          { code: 12345, message: "private-diagnostic-message" },
          { code: "private-diagnostic-code" }
        ], detail: "private-response-body" }, { status: 400 });
      }
      const result = pathname === "/client/v4/zones"
        ? [{ id: "test-zone", name: "getborai.com", status: "active" }]
        : [];
      return Response.json({ success: true, result, result_info: { total_pages: 1 } });
    };
    await import(process.argv[1]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", fixture, file], {
    encoding: "utf8", timeout: 10000,
    env: { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_AUDIT_API_TOKEN: "private-test-token" }
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Pages projects: UNVERIFIED HTTP 400 API error codes=12345 \(response body suppressed\)/);
  assert.match(result.stdout, /Result: INCOMPLETE/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-(?:diagnostic-message|diagnostic-code|response-body|test-token)/);
});

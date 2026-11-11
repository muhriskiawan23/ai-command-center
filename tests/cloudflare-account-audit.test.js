import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(new URL("../.github/workflows/cloudflare-vpc-account-audit.yml", import.meta.url), "utf8");
const script = workflow.split("<<'NODE'\n")[1].split("          NODE")[0]
  .replace('import fs from "node:fs";', "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function audit(respond, configured = true) {
  let summary = "";
  const messages = [];
  const requests = [];
  const process = { env: configured ? {
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "secret-must-not-appear",
    AUDIT_CREDENTIAL_SOURCE: "dedicated audit secret",
    GITHUB_STEP_SUMMARY: "summary"
  } : {} };
  await new AsyncFunction("fs", "process", "fetch", "console", script)(
    { appendFileSync: (_path, content) => { summary += content; } },
    process,
    async (url, options) => {
      requests.push({ url, method: options.method });
      return respond(url);
    },
    { log: (...parts) => messages.push(parts.join(" ")) }
  );
  assert.ok(!summary.includes("secret-must-not-appear"));
  assert.ok(!messages.join("\n").includes("secret-must-not-appear"));
  assert.ok(requests.every(({ method }) => method === "GET"));
  return { summary, exitCode: process.exitCode, requests };
}

function success(url, info = { total_count: 0, total_pages: 1 }) {
  return { ok: true, status: 200, json: async () => ({
    success: true,
    result: url.includes("/cni/") ? { items: [], next: null } : [],
    result_info: info
  }) };
}

test("complete authorized empty inventories pass without exposing credentials", async () => {
  const result = await audit(success);
  assert.equal(result.exitCode, undefined);
  assert.match(result.summary, /Coverage: COMPLETE/);
  assert.equal(result.requests.length, 8);
});

test("permission denial fails the audit while retaining all inventory results", async () => {
  const result = await audit(url => url.includes("/gateway/")
    ? { ok: false, status: 403 } : success(url));
  assert.equal(result.exitCode, 1);
  assert.match(result.summary, /Gateway policies:\*\* PERMISSION DENIED/);
  assert.match(result.summary, /PARTIAL \/ ACTION REQUIRED/);
  assert.equal(result.requests.length, 8);
});

test("additional pages cannot produce a complete inventory", async () => {
  for (const path of ["/tunnels?", "/warp_connector?", "/teamnet/", "/gateway/"]) {
    const result = await audit(url => success(url, url.includes(path)
      ? { total_count: 101, total_pages: 2 } : undefined));
    assert.equal(result.exitCode, 1, path);
    assert.match(result.summary, /PAGINATION INCOMPLETE/);
  }
});

test("missing credentials and unsupported endpoints never count as passed", async () => {
  const missing = await audit(success, false);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.requests.length, 0);
  const unsupported = await audit(url => url.includes("/onramps")
    ? { ok: false, status: 404 } : success(url));
  assert.equal(unsupported.exitCode, 1);
  assert.match(unsupported.summary, /HTTP 404/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(new URL("../.github/workflows/cloudflare-vpc-account-audit.yml", import.meta.url), "utf8");
const script = workflow.split("<<'NODE'\n")[1].split("          NODE")[0]
  .replace('import fs from "node:fs";', "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function audit(respond, configured = true, onrampsInScope = true) {
  let summary = "";
  const messages = [];
  const requests = [];
  const process = { env: configured ? {
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "secret-must-not-appear",
    AUDIT_CREDENTIAL_SOURCE: "dedicated audit secret",
    AUDIT_CLOUD_ONRAMPS_IN_SCOPE: String(onrampsInScope),
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
  if (url.includes("/cni/")) return response({ items: [] });
  return { ok: true, status: 200, json: async () => ({
    success: true,
    result: [],
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

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test("CNI and interconnect use top-level items and walk numeric cursors, including zero", async () => {
  const result = await audit(url => {
    if (!url.includes("/cni/")) return success(url);
    const cursor = new URL(url).searchParams.get("cursor");
    return response(cursor == null ? { items: [{ name: "private-resource" }], next: 0 } : { items: [] });
  });
  assert.equal(result.exitCode, undefined);
  assert.equal(result.requests.filter(r => r.url.includes("cursor=0")).length, 2);
  assert.ok(!result.summary.includes("private-resource"));
  assert.match(result.summary, /returned=1; additional_page=no/);
});

test("CNI rejects error envelopes, nested legacy shape, invalid and repeating cursors", async () => {
  for (const payload of [
    { items: [], success: false }, { items: [], errors: [{ code: 1000 }] },
    { success: true, result: { items: [] } }, { items: [], next: "untrusted" },
    { items: [], next: 5 }
  ]) {
    const result = await audit(url => url.includes("/cni/") ? response(payload) : success(url));
    assert.equal(result.exitCode, 1);
    assert.ok(result.requests.length <= 10);
  }
});

test("Directory walks pages without metadata until an explicit empty terminal page", async () => {
  const result = await audit(url => {
    if (!url.includes("/directory/services")) return success(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return response({ success: true, result: page === 1 ? [{ name: "private-service", type: "http" }] : [] });
  });
  assert.equal(result.exitCode, undefined);
  assert.match(result.summary, /returned=1; completion=empty terminal page/);
  assert.equal(result.requests.filter(r => r.url.includes("/directory/services")).length, 2);
  assert.ok(!result.summary.includes("private-service"));
});

test("Directory follows reported pages and refuses inconsistent or unbounded pagination", async () => {
  const paged = await audit(url => {
    if (!url.includes("/directory/services")) return success(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return response({ success: true, result: [{ type: "http" }], result_info: { page, total_pages: 2, total_count: 2 } });
  });
  assert.equal(paged.exitCode, undefined);
  assert.match(paged.summary, /completion=reported total_pages/);
  for (const payload of [
    { success: true, result: [], result_info: { page: 999 } },
    { success: true, result: [], result_info: { total_pages: 2, total_count: 1 } },
    { success: true, result: [{ type: "http" }] },
    { success: true, result: [], result_info: { total_pages: 0, total_count: 1 } }
  ]) {
    const result = await audit(url => url.includes("/directory/services") ? response(payload) : success(url));
    assert.equal(result.exitCode, 1);
    assert.ok(result.requests.filter(r => r.url.includes("/directory/services")).length <= 10);
  }
});

test("on-ramp 404 preserves numeric diagnostic codes but never response messages", async () => {
  const result = await audit(url => url.includes("/onramps") ? {
    ok: false, status: 404,
    json: async () => ({ errors: [{ code: 7003, message: "private-network-details" }] })
  } : success(url));
  assert.equal(result.exitCode, 1);
  assert.match(result.summary, /HTTP 404; codes=7003/);
  assert.match(result.summary, /Closed Beta/);
  assert.ok(!result.summary.includes("private-network-details"));
});


test("optional beta on-ramps are visibly excluded without claiming an empty inventory", async () => {
  const result = await audit(url => {
    assert.ok(!url.includes("/magic/cloud/onramps"));
    return success(url);
  }, true, false);
  assert.equal(result.exitCode, undefined);
  assert.match(result.summary, /OUT OF SCOPE \(UNVERIFIED\)/);
  assert.match(result.summary, /COMPLETE FOR CONFIGURED SCOPE \(ON-RAMPS UNVERIFIED\)/);
  assert.equal(result.requests.length, 7);
});

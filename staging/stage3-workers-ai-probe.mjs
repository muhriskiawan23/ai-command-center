import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { calculateProviderCostMicroUsd } from "../src/credit-metering.js";
import { strictProviderTokenUsage } from "../src/provider-usage-journal.js";

const account = "8004820f480977e67efd6fa03c10a018";
const database = "92bddc48-0c5a-4996-886b-7340e64d3120";
const worker = "bor-ai-stage3-metering-sandbox-01";
const path = `/workers/scripts/${worker}`;
const token = process.env.STAGE3_WORKER_TOKEN;

assert.equal(process.env.GITHUB_REPOSITORY, "muhriskiawan23/ai-command-center");
assert.equal(process.env.GITHUB_REF, "refs/heads/ops/stage3-workers-ai-metering-01");
assert.equal(process.env.GITHUB_RUN_ATTEMPT, "1");
assert.ok(token, "Worker deploy secret missing");

async function api(endpoint, { method = "GET", body, missing = false } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(typeof body === "string" ? { "Content-Type": "application/json" } : {})
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => null);
  if (missing && response.status === 404) return null;
  if (!response.ok || payload?.success !== true) {
    const codes = (payload?.errors ?? []).map(error => Number(error.code)).filter(Number.isSafeInteger);
    throw new Error(`Cloudflare ${method} failed (HTTP ${response.status}, codes ${codes.join(",")})`);
  }
  return payload.result;
}

function route(enabled, missing = false) {
  return api(`${path}/subdomain`, { method: "POST", body: JSON.stringify({ enabled, previews_enabled: false }), missing });
}

async function run() {
  const identity = await api("/tokens/verify");
  assert.equal(identity.id, "8112cb2ae9ba14ef58bd6b62560ac642");
  assert.equal(identity.status, "active");
  const { subdomain } = await api("/workers/subdomain");
  assert.match(subdomain || "", /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

  const key = randomBytes(32).toString("hex");
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({
    main_module: "worker.mjs",
    compatibility_date: "2026-10-28",
    bindings: [
      { name: "STAGE3_DB", type: "d1", id: database },
      { name: "AI", type: "ai" },
      { name: "METERING_KEY", type: "secret_text", text: key }
    ]
  })], { type: "application/json" }), "metadata.json");
  form.append("worker.mjs", new Blob([readFileSync(new URL("./stage3-workers-ai-metering-worker.js", import.meta.url))], {
    type: "application/javascript+module"
  }), "worker.mjs");
  await api(path, { method: "PUT", body: form });

  const origin = `https://${worker}.${subdomain}.workers.dev`;
  try {
    await route(true);
    let ready = false;
    for (let check = 0; check < 15; check++) {
      const response = await fetch(`${origin}/ready`, { redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (response?.ok && (await response.json().catch(() => null))?.ready === true) {
        ready = true;
        break;
      }
      await delay(3000);
    }
    assert.ok(ready, "Sandbox Worker did not become ready");
    // There is no retry after dispatch, including after a transport timeout.
    const result = await fetch(`${origin}/probe`, {
      method: "POST", headers: { "X-BOR-Metering-Key": key }, redirect: "error", signal: AbortSignal.timeout(45000)
    });
    const evidence = await result.json().catch(() => null);
    console.log(JSON.stringify({ status: result.status, ray: result.headers.get("cf-ray"), ...evidence }));
    assert.equal(result.status, 200, "Live sandbox request did not succeed");
    const usage = strictProviderTokenUsage(evidence?.counters);
    assert.ok(usage, "Provider response did not supply complete, consistent token counters");
    assert.ok(usage.outputTokens <= 16, "Reported output exceeded the configured cap");
    const estimatedMicroUsd = calculateProviderCostMicroUsd({
      ...usage,
      inputRateMicroUsdPerMillion: 293000n,
      outputRateMicroUsdPerMillion: 2253000n
    });
    const estimatedMicroNeurons = BigInt(usage.inputTokens) * 26668n + BigInt(usage.outputTokens) * 204805n;
    console.log(JSON.stringify({
      measuredResponseTokens: usage,
      estimatedMicroUsdBeforeFreeAllocation: String(estimatedMicroUsd),
      estimatedMicroNeurons: String(estimatedMicroNeurons),
      invoiceVerified: false
    }));
  } finally {
    await route(false);
  }
}

switch (process.argv[2]) {
  case "run": await run(); break;
  case "close": {
    const result = await route(false, true);
    if (result !== null) {
      const settings = await api(`${path}/subdomain`);
      assert.equal(settings.enabled, false);
      assert.equal(settings.previews_enabled, false);
    }
    break;
  }
  default: throw new Error("Unknown metering operation");
}

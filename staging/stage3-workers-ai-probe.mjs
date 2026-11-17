import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { calculateProviderCostMicroUsd } from "../src/credit-metering.js";

const account = "8004820f480977e67efd6fa03c10a018";
const database = process.env.STAGE3_DATABASE;
const databaseName = "bor-ai-s3-live-settlement-" + process.env.GITHUB_RUN_ID;
const worker = "bor-ai-stage3-settlement-sandbox-01";
const path = `/workers/scripts/${worker}`;
const token = process.env.STAGE3_WORKER_TOKEN;

assert.equal(process.env.GITHUB_REPOSITORY, "muhriskiawan23/ai-command-center");
assert.equal(process.env.GITHUB_REF, "refs/heads/ops/stage3-workers-ai-settlement-01");
assert.equal(process.env.GITHUB_RUN_ATTEMPT, "1");
assert.match(process.env.GITHUB_RUN_ID || "", /^\d{1,15}$/);

async function api(endpoint, { method = "GET", body, missing = false, credential = token } = {}) {
  assert.ok(credential, "Required sandbox secret missing");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${credential}`,
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
  validateDatabaseId(database);
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
  form.append("worker.mjs", new Blob([readFileSync(join(process.env.RUNNER_TEMP, "stage3-settlement.mjs"))], {
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
    const send = key => fetch(`${origin}/probe`, {
      method: "POST", headers: { "X-BOR-Metering-Key": key }, redirect: "error", signal: AbortSignal.timeout(45000)
    });
    assert.equal((await send("invalid")).status, 401);
    const result = await send(key);
    const evidence = await result.json().catch(() => null);
    console.log(JSON.stringify({ status: result.status, ray: result.headers.get("cf-ray"), ...evidence }));
    assert.equal(result.status, 200, "Live sandbox settlement failed");
    assert.ok(Number.isSafeInteger(evidence.outputTokens) && evidence.outputTokens <= 16);
    const replay = await send(key);
    assert.equal(replay.status, 409);
    assert.deepEqual(await replay.json(), { error: "provider_budget_reservation_rejected", modelInvoked: false });
    console.log("PASS: sandbox Worker settled one inference and rejected replay before model dispatch.");
  } finally {
    await route(false);
  }
}

function validateDatabaseId(id) {
  assert.match(id || "", /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
}

function d1(endpoint, json) {
  assert.equal(process.env.STAGE3_D1_ACCOUNT, account);
  assert.ok(process.env.STAGE3_D1_TOKEN, "Required sandbox D1 secret missing");
  return api(`/d1/database${endpoint}`, {
    credential: process.env.STAGE3_D1_TOKEN,
    ...(json === undefined ? {} : { method: "POST", body: JSON.stringify(json) })
  });
}

async function confirmDatabase(id) {
  validateDatabaseId(id);
  assert.equal((await d1(`/${id}`)).name, databaseName);
}

async function sql(id, statement) {
  const results = await d1(`/${id}/query`, { sql: statement });
  assert.ok(results.length && results.every(result => result.success === true));
  return results.flatMap(result => result.results ?? []);
}

async function provision() {
  const created = await d1("", { name: databaseName });
  await confirmDatabase(created.uuid);
  assert.deepEqual(await sql(created.uuid, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV'"), []);
  for (const file of ["0012_credit_ledger", "0013_provider_spend_budget", "0014_provider_usage_journal"]) {
    await sql(created.uuid, readFileSync(new URL(`../migrations/${file}.sql`, import.meta.url), "utf8"));
  }
  await sql(created.uuid, `
    INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at) VALUES ('stage3-live-test-wallet',7069,1);
    INSERT INTO provider_budget_limits (provider,daily_cap_micro_usd,updated_at) VALUES ('workers-ai-free-sandbox',7069,1),('__global__',7069,1);
  `);
  appendFileSync(process.env.GITHUB_OUTPUT, `database=${created.uuid}\n`);
  console.log(`Prepared ${databaseName} (${created.uuid}) with a 7069 micro-USD estimate cap and synthetic wallet.`);
}

async function verify() {
  await confirmDatabase(database);
  const events = await sql(database, "SELECT event_kind,input_tokens,output_tokens,provider_cost_micro_usd FROM provider_usage_events ORDER BY rowid");
  const [budget] = await sql(database, "SELECT status,reserved_micro_usd,actual_micro_usd FROM provider_budget_reservations");
  const [wallet] = await sql(database, "SELECT status,reserved_microcredits,settled_microcredits FROM credit_reservations");
  const [balance] = await sql(database, "SELECT balance_microcredits FROM credit_accounts");
  console.log(JSON.stringify({ events, budget, wallet, balance, invoiceVerified: false }));
  assert.deepEqual(events.map(event => event.event_kind), ["dispatched", "usage_measured"]);
  const measured = events[1];
  const estimate = Number(calculateProviderCostMicroUsd({
    inputTokens: measured.input_tokens,
    outputTokens: measured.output_tokens,
    inputRateMicroUsdPerMillion: 293000n,
    outputRateMicroUsdPerMillion: 2253000n
  }));
  assert.equal(measured.provider_cost_micro_usd, estimate);
  assert.deepEqual(budget, { status: "settled", reserved_micro_usd: 7069, actual_micro_usd: estimate });
  assert.deepEqual(wallet, { status: "settled", reserved_microcredits: 7069, settled_microcredits: estimate });
  assert.deepEqual(balance, { balance_microcredits: 7069 - estimate });
  const records = await sql(database, "SELECT COUNT(*) AS n FROM credit_reservations UNION ALL SELECT COUNT(*) FROM provider_budget_reservations");
  assert.deepEqual(records, [{n:1}, {n:1}]);
  console.log("PASS: remote journal, budget and wallet reconcile to one metered sandbox inference.");
}

switch (process.argv[2]) {
  case "run": await run(); break;
  case "provision": await provision(); break;
  case "verify": await verify(); break;
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

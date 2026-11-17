import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const account = "8004820f480977e67efd6fa03c10a018";
const { GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt } = process.env;
assert.equal(process.env.GITHUB_REPOSITORY, "muhriskiawan23/ai-command-center");
assert.equal(process.env.GITHUB_REF, "refs/heads/ops/stage3-authenticated-worker-proof-01");
assert.match(run || "", /^\d{1,15}$/);
assert.match(attempt || "", /^\d{1,3}$/);
const workerName = `bor-ai-s3-auth-${run}-${attempt}`;
const databaseName = `bor-ai-s3-auth-d1-${run}-${attempt}`;
const scriptPath = `/workers/scripts/${workerName}`;
const apiKey = "borai_live_stage3_synthetic_fixture_only_00001";
const sessionToken = user => createHash("sha256").update(`sandbox:${run}:${attempt}:${user}`).digest("hex");
const workerToken = process.env.STAGE3_WORKER_TOKEN;
const d1Token = process.env.STAGE3_D1_TOKEN;

function output(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function api(token, path, { method = "GET", json, form, allowMissing = false } = {}) {
  assert.ok(token, "Required environment secret is missing");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => null);
  if (allowMissing && response.status === 404) return null;
  if (!response.ok || payload?.success !== true) {
    const codes = (payload?.errors ?? []).map(error => Number(error.code)).filter(Number.isSafeInteger);
    throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}, codes: ${codes.join(",")})`);
  }
  return payload.result;
}

function dbId(value) {
  assert.match(value || "", /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  return value;
}

async function getDatabase(id) {
  assert.equal(process.env.STAGE3_D1_ACCOUNT, account);
  const database = await api(d1Token, `/d1/database/${dbId(id)}`);
  assert.equal(database.name, databaseName);
}

async function query(id, sql, params) {
  const result = await api(d1Token, `/d1/database/${dbId(id)}/query`, {
    method: "POST", json: { sql, ...(params ? { params } : {}) }
  });
  assert.ok(Array.isArray(result) && result.length && result.every(entry => entry.success === true), "D1 query failed");
  return result.flatMap(entry => entry.results || []);
}

async function preflight() {
  const token = await api(workerToken, "/tokens/verify");
  assert.equal(token.status, "active");
  assert.equal(token.id, "8112cb2ae9ba14ef58bd6b62560ac642");
  const { subdomain } = await api(workerToken, "/workers/subdomain");
  assert.match(subdomain || "", /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  output("subdomain", subdomain);
  console.log("Sandbox Worker deploy token active and workers.dev subdomain verified.");
}

async function provision() {
  assert.equal(process.env.STAGE3_D1_ACCOUNT, account);
  const database = await api(d1Token, "/d1/database", { method: "POST", json: { name: databaseName } });
  const id = dbId(database.uuid);
  assert.equal(database.name, databaseName);
  await getDatabase(id);
  assert.deepEqual(await query(id, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV'"), []);
  for (const file of ["0001_auth_and_chat", "0002_daily_usage", "0003_user_memory", "0004_conversation_pinning", "0005_conversation_archive",
    "0006_chat_request_idempotency", "0008_message_link_sources", "0009_public_api_keys", "0012_credit_ledger", "0013_provider_spend_budget", "0014_provider_usage_journal"]) {
    await query(id, readFileSync(new URL(`../migrations/${file}.sql`, import.meta.url), "utf8"));
  }
  await query(id, `
    CREATE TABLE stage3_staging_requests (id TEXT PRIMARY KEY);
    CREATE TABLE stage3_telegram_accounts (telegram_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));
    INSERT INTO users (id,email,created_at,updated_at) VALUES
      ('stage3-web','web@example.test',1,1),('stage3-api','api@example.test',1,1),('stage3-telegram','telegram@example.test',1,1);
    INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at) VALUES
      ('stage3-web',100000,1),('stage3-api',100000,1),('stage3-telegram',100000,1);
    INSERT INTO stage3_telegram_accounts (telegram_id,user_id) VALUES (77,'stage3-telegram');
    INSERT INTO provider_budget_limits (provider,daily_cap_micro_usd,updated_at) VALUES ('stage3-synthetic',100000,1),('__global__',100000,1);
  `);
  for (const userId of ["stage3-web", "stage3-api"]) {
    const hash = createHash("sha256").update(sessionToken(userId)).digest("hex");
    await query(id, "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,1)",
      [hash, userId, String(Math.floor(Date.now() / 1000) + 3600)]);
  }
  await query(id, `INSERT INTO public_api_keys (id,user_id,key_hash,label,allowed_origins,created_at,updated_at)
    VALUES ('stage3-key','stage3-api',?,'synthetic','["https://shop.example"]',1,1)`, [createHash("sha256").update(apiKey).digest("hex")]);
  output("database", id);
  console.log(`Prepared sandbox D1 ${databaseName} (${id}).`);
}

async function route(enabled, allowMissing = false) {
  return api(workerToken, `${scriptPath}/subdomain`, {
    method: "POST", json: { enabled, previews_enabled: false }, allowMissing
  });
}

async function deploy() {
  const id = dbId(process.env.STAGE3_DATABASE);
  const subdomain = process.env.STAGE3_SUBDOMAIN;
  assert.match(subdomain || "", /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  const key = randomBytes(32).toString("hex");
  const telegramSecret = randomBytes(32).toString("hex");
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({
    main_module: "worker.mjs",
    compatibility_date: "2026-10-28",
    compatibility_flags: ["enable_request_signal"],
    bindings: [
      { name: "STAGE3_DB", type: "d1", id },
      { name: "STAGE3_MODE", type: "plain_text", text: "synthetic" },
      { name: "STAGE3_OPERATOR_KEY", type: "secret_text", text: key },
      { name: "STAGE3_TELEGRAM_WEBHOOK_SECRET", type: "secret_text", text: telegramSecret }
    ]
  })], { type: "application/json" }), "metadata.json");
  form.append("worker.mjs", new Blob([readFileSync(join(process.env.RUNNER_TEMP, "stage3-worker.mjs"))], {
    type: "application/javascript+module"
  }), "worker.mjs");
  await api(workerToken, scriptPath, { method: "PUT", form });
  const origin = `https://${workerName}.${subdomain}.workers.dev`;
  const send = (path, body, extra = {}, request = randomBytes(16).toString("hex")) => fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BOR-Stage3-Key": key, "X-BOR-Stage3-Request": request, ...extra },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(20000)
  });
  const chat = "/api/chat";
  const single = { message: "Apa ibu kota Jepang?", requestId: randomUUID(), userId: "stage3-api" };
  const webHeaders = userId => ({ Origin: origin, Cookie: `__Host-borai_session=${sessionToken(userId)}` });
  const web = webHeaders("stage3-web");
  try {
    await route(true);
    let ready = false;
    for (let check = 0; check < 20; check++) {
      const probe = await send(chat, single, { "X-BOR-Stage3-Key": "invalid" }).catch(() => null);
      if (probe?.status === 401 && (await probe.json().catch(() => null))?.error === "Stage 3 authentication required") {
        ready = true;
        break;
      }
      await delay(3000);
    }
    assert.ok(ready, "Sandbox Worker did not become ready");
    assert.equal((await send(chat, single)).status, 401);
    const responses = await Promise.all(Array.from({ length: 3 }, () => send(chat, single, web)));
    const unexpected = responses.filter(response => response.status !== 200 && response.status !== 409);
    for (const response of unexpected) {
      const info = await response.json().catch(() => null);
      console.log("Unexpected sandbox chat result", {
        status: response.status, ray: response.headers.get("cf-ray"), error: info?.error, code: info?.code
      });
    }
    assert.equal(unexpected.length, 0, "Unexpected status during authenticated concurrent chat");
    const accepted = await Promise.all(responses.filter(response => response.status === 200).map(response => response.json()));
    assert.equal(accepted.filter(answer => !answer.replayed && answer.saved).length, 1);
    assert.equal((await (await send(chat, single, web)).json()).replayed, true);
    assert.equal((await send(chat, single, webHeaders("stage3-api"))).status, 200);

    const multi = await send(chat, { message: "Buat analisis risiko dan strategi untuk bisnis saya.", requestId: randomUUID() }, web);
    assert.equal(multi.status, 200);
    assert.equal((await multi.json()).workflow, "multi-agent");
    const webhook = "/api/integrations/telegram/webhook";
    const telegram = { update_id: 42, message: { chat: { id: 77, type: "private" }, from: { id: 77 }, text: single.message } };
    assert.equal((await send(webhook, telegram)).status, 401);
    const telegramHeaders = { "X-Telegram-Bot-Api-Secret-Token": telegramSecret };
    const unlinked = { ...telegram, message: { ...telegram.message, from: { id: 88 } } };
    assert.equal((await send(webhook, unlinked, telegramHeaders)).status, 401);
    assert.deepEqual(await (await send(webhook, telegram, telegramHeaders)).json(), { ok: true });
    assert.equal((await send(webhook, telegram, telegramHeaders)).status, 409);

    const publicHeaders = { Origin: "https://shop.example", Authorization: `Bearer ${apiKey}` };
    const publicId = randomBytes(16).toString("hex");
    assert.equal((await send("/api/public/chat", single, { ...publicHeaders, Origin: "https://other.example" }, publicId)).status, 403);
    assert.equal((await send("/api/public/chat", { ...single, userId: "stage3-web" }, publicHeaders, publicId)).status, 200);
    assert.equal((await send("/api/public/chat", single, publicHeaders, publicId)).status, 409);

    for (const mode of ["unverified", "wallet-finalization-failure"]) {
      const failure = { ...single, requestId: randomUUID() };
      assert.equal((await send(chat, failure, { ...web, "X-BOR-Stage3-Usage": mode })).status, 502);
      assert.equal((await send(chat, failure, web)).status, 409);
    }
    console.log(`PASS: sandbox Worker ${workerName} authenticated all four paths, refused replay and kept unreconciled holds.`);
  } finally {
    await route(false);
  }
}

async function verify() {
  const id = dbId(process.env.STAGE3_DATABASE);
  await getDatabase(id);
  const [proof] = await query(id, `SELECT
    (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_measured') AS measured,
    (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_unverified') AS unverified,
    (SELECT COUNT(*) FROM credit_reservations WHERE status='reserved') AS wallet_holds,
    (SELECT COUNT(*) FROM provider_budget_reservations WHERE status='reserved') AS budget_holds,
    (SELECT COUNT(*) FROM credit_reservations WHERE status='settled') AS wallet_settlements,
    (SELECT COUNT(*) FROM provider_budget_reservations WHERE status='settled') AS budget_settlements`);
  const [state] = await query(id, `SELECT
    (SELECT COUNT(*) FROM stage3_staging_requests) AS claimed,
    (SELECT COUNT(*) FROM sessions WHERE expires_at > unixepoch()) AS active_sessions,
    (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='dispatched') AS dispatched`);
  console.log(JSON.stringify({ proof, state }));
  assert.deepEqual(proof, { measured: 9, unverified: 1, wallet_holds: 2, budget_holds: 1, wallet_settlements: 8, budget_settlements: 9 });
  const wallets = await query(id, `SELECT user_id, COUNT(*) AS settlements, SUM(settled_microcredits) AS debits
    FROM credit_reservations WHERE status='settled' GROUP BY user_id ORDER BY user_id`);
  assert.deepEqual(wallets, [
    { user_id: "stage3-api", settlements: 2, debits: 1038 },
    { user_id: "stage3-telegram", settlements: 1, debits: 519 },
    { user_id: "stage3-web", settlements: 5, debits: 2595 }
  ]);
  console.log("PASS: remote sandbox D1 confirms 8 wallet settlements across 3 authenticated accounts and both failure recovery states.");
}

switch (process.argv[2]) {
  case "preflight": await preflight(); break;
  case "provision": await provision(); break;
  case "deploy": await deploy(); break;
  case "close": {
    const closed = await route(false, true);
    if (closed !== null) {
      const settings = await api(workerToken, `${scriptPath}/subdomain`);
      assert.equal(settings.enabled, false);
      assert.equal(settings.previews_enabled, false);
    }
    break;
  }
  case "verify": await verify(); break;
  default: throw new Error("Unknown Stage 3 operation");
}

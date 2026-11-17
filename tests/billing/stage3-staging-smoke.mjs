import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const lockedRequire = createRequire(new URL("./stage3-wrangler-lock/package.json", import.meta.url));
const { build } = lockedRequire("esbuild");
const { Miniflare, convertV4MiniflareOptions } = lockedRequire("miniflare");
const { unstable_splitSqlQuery } = lockedRequire("wrangler");
const operatorKey = randomBytes(32).toString("hex");
const fixtureApiKey = `borai_live_${randomBytes(24).toString("hex")}`;
const headers = { "Content-Type": "application/json", "X-BOR-Stage3-Key": operatorKey };
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../../staging/stage3-worker.js", import.meta.url))],
  bundle: true, format: "esm", platform: "browser", write: false
});
const miniflare = new Miniflare(convertV4MiniflareOptions({
  cf: false,
  workers: [{
    name: "bor-ai-stage3-synthetic",
    modules: true,
    script: outputFiles[0].text,
    compatibilityDate: "2026-10-28",
    compatibilityFlags: ["enable_request_signal"],
    bindings: { STAGE3_MODE: "synthetic", STAGE3_OPERATOR_KEY: operatorKey },
    d1Databases: ["STAGE3_DB"],
    outboundService() { throw new Error("External requests are disabled in Stage 3 smoke"); }
  }]
}));

try {
  const db = await miniflare.getD1Database("STAGE3_DB");
  const sql = async source => db.batch(unstable_splitSqlQuery(source).map(statement => db.prepare(statement)));
  const migrations = ["0001_auth_and_chat", "0002_daily_usage", "0009_public_api_keys", "0012_credit_ledger",
    "0013_provider_spend_budget", "0014_provider_usage_journal"];
  for (const name of migrations) await sql(readFileSync(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
  await sql(`
    CREATE TABLE stage3_staging_requests (id TEXT PRIMARY KEY);
    INSERT INTO users (id,email,created_at,updated_at) VALUES ('stage3-synthetic-user','stage3@example.test',1,1);
    INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at) VALUES ('stage3-synthetic-user',100000,1);
    INSERT INTO provider_budget_limits (provider,daily_cap_micro_usd,updated_at) VALUES
      ('stage3-synthetic',100000,1),('__global__',100000,1);
  `);
  await db.prepare(`INSERT INTO public_api_keys (id,user_id,key_hash,label,allowed_origins,created_at,updated_at)
    VALUES ('stage3-key','stage3-synthetic-user',?,'synthetic','["https://shop.example"]',1,1)`)
    .bind(createHash("sha256").update(fixtureApiKey).digest("hex")).run();

  const send = (path, body, extra = {}, id = randomBytes(16).toString("hex")) => miniflare.dispatchFetch(`http://localhost${path}`, {
    method: "POST", headers: { ...headers, "X-BOR-Stage3-Request": id, ...extra }, body: JSON.stringify(body)
  });
  const single = { message: "Apa ibu kota Jepang?" };
  const readCount = async (table, condition = "1=1") => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${condition}`).first()).n;

  assert.equal((await send("/api/chat", single, { "X-BOR-Stage3-Key": "invalid" })).status, 401);
  assert.equal(await readCount("stage3_staging_requests"), 0);
  const repeatId = randomBytes(16).toString("hex");
  const duplicates = await Promise.all(Array.from({ length: 3 }, () => send("/api/chat", single, {}, repeatId)));
  assert.deepEqual(duplicates.map(response => response.status).sort(), [200, 409, 409]);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 1);

  const multi = await send("/api/chat", { message: "Buat analisis risiko dan strategi untuk bisnis saya." });
  assert.equal(multi.status, 200);
  assert.equal((await multi.json()).workflow, "multi-agent");
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 5);

  const webhook = "/api/integrations/telegram/webhook";
  const telegram = { message: { chat: { id: 77, type: "private" }, from: { id: 77 }, text: single.message } };
  assert.equal((await send(webhook, telegram)).status, 401);
  const telegramResponse = await send(webhook, telegram, { "X-Telegram-Bot-Api-Secret-Token": operatorKey });
  assert.deepEqual(await telegramResponse.json(), { ok: true });

  const publicHeaders = { Origin: "https://shop.example", Authorization: `Bearer ${fixtureApiKey}` };
  assert.equal((await send("/api/public/chat", single, { ...publicHeaders, Origin: "https://other.example" })).status, 403);
  const publicResponse = await send("/api/public/chat", single, publicHeaders);
  assert.equal(publicResponse.status, 200);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 7);
  const wallet = await db.prepare("SELECT balance_microcredits AS balance FROM credit_accounts").first();
  assert.equal(wallet.balance, 100000 - 7 * 519);

  const unknown = await send("/api/chat", single, { "X-BOR-Stage3-Usage": "unverified" });
  assert.equal(unknown.status, 502);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_unverified'"), 1);
  assert.equal(await readCount("credit_reservations", "status='reserved'"), 1);
  assert.equal(await readCount("provider_budget_reservations", "status='reserved'"), 1);
  console.log("PASS: four Worker routes, one debit per replay group, seven measured settlements, unknown usage held");
} finally {
  await miniflare.dispose();
}

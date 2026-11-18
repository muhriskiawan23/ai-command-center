import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const lockedRequire = createRequire(new URL("./stage3-wrangler-lock/package.json", import.meta.url));
const { build } = lockedRequire("esbuild");
const { Miniflare, convertV4MiniflareOptions } = lockedRequire("miniflare");
const { unstable_splitSqlQuery } = lockedRequire("wrangler");
const operatorKey = randomBytes(32).toString("hex");
const webhookSecret = randomBytes(32).toString("hex");
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
    bindings: { STAGE3_MODE: "synthetic", STAGE3_OPERATOR_KEY: operatorKey, STAGE3_TELEGRAM_WEBHOOK_SECRET: webhookSecret },
    d1Databases: ["STAGE3_DB"],
    outboundService() { throw new Error("External requests are disabled in Stage 3 smoke"); }
  }]
}));

try {
  const db = await miniflare.getD1Database("STAGE3_DB");
  const sql = async source => db.batch(unstable_splitSqlQuery(source).map(statement => db.prepare(statement)));
  const migrations = ["0001_auth_and_chat", "0002_daily_usage", "0003_user_memory", "0004_conversation_pinning",
    "0005_conversation_archive", "0006_chat_request_idempotency", "0008_message_link_sources", "0009_public_api_keys",
    "0012_credit_ledger", "0013_provider_spend_budget", "0014_provider_usage_journal",
    "0016_plan_entitlements_draft"];
  for (const name of migrations) await sql(readFileSync(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
  await sql(`
    CREATE TABLE stage3_staging_requests (id TEXT PRIMARY KEY);
    CREATE TABLE stage3_telegram_accounts (telegram_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));
    INSERT INTO users (id,email,created_at,updated_at) VALUES
      ('stage3-web','web@example.test',1,1),('stage3-api','api@example.test',1,1),
      ('stage3-telegram','telegram@example.test',1,1),('stage3-free','free@example.test',1,1);
    INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at) VALUES
      ('stage3-web',100000,1),('stage3-api',100000,1),
      ('stage3-telegram',100000,1),('stage3-free',100000,1);
    INSERT INTO stage3_telegram_accounts (telegram_id,user_id) VALUES (77,'stage3-telegram');
    INSERT INTO provider_budget_limits (provider,daily_cap_micro_usd,updated_at) VALUES
      ('stage3-synthetic',100000,1),('__global__',100000,1);
  `);
  // Disposable, fictional payment proofs are the *only* source of paid
  // entitlement in this local workerd proof; no gateway/provider is called.
  const now = Math.floor(Date.now()/1000);
  for (const [user,tier] of [["stage3-web","pro"],["stage3-api","basic"],["stage3-telegram","basic"]]) {
    const orderId="synthetic-plan-"+user;
    await db.prepare("INSERT INTO verified_plan_payments "+
      "(order_id,user_id,purchased_tier,verification_status,verified_at,updated_at) "+
      "VALUES (?,?,?,'verified_paid',?,?)")
      .bind(orderId,user,tier,now-120,now-60).run();
    await db.prepare("INSERT INTO plan_entitlements "+
      "(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) "+
      "VALUES (?,?,?,'active',?,?,?)")
      .bind(user,tier,orderId,now-60,now+3600,now).run();
  }
  const sessionHeaders = {};
  for (const user of ["stage3-web", "stage3-api", "stage3-free"]) {
    const token = randomBytes(32).toString("hex");
    await db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,1)")
      .bind(createHash("sha256").update(token).digest("hex"), user, Math.floor(Date.now() / 1000) + 3600).run();
    sessionHeaders[user] = { Origin: "http://localhost", Cookie: `__Host-borai_session=${token}` };
  }
  await db.prepare(`INSERT INTO public_api_keys (id,user_id,key_hash,label,allowed_origins,created_at,updated_at)
    VALUES ('stage3-key','stage3-api',?,'synthetic','["https://shop.example"]',1,1)`)
    .bind(createHash("sha256").update(fixtureApiKey).digest("hex")).run();

  const send = (path, body, extra = {}, id = randomBytes(16).toString("hex")) => miniflare.dispatchFetch(`http://localhost${path}`, {
    method: "POST", headers: { ...headers, "X-BOR-Stage3-Request": id, ...extra }, body: JSON.stringify(body)
  });
  const single = { message: "Apa ibu kota Jepang?", requestId: randomUUID(), userId: "stage3-api" };
  const readCount = async (table, condition = "1=1") => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${condition}`).first()).n;
  const web = sessionHeaders["stage3-web"];

  assert.equal((await send("/api/chat", single, { "X-BOR-Stage3-Key": "invalid" })).status, 401);
  assert.equal((await send("/api/chat", single)).status, 401);
  assert.equal((await send("/api/chat", single, { ...web, Origin: "https://other.example" })).status, 403);
  assert.equal((await send("/api/chat", { message: single.message }, web)).status, 400);
  assert.equal(await readCount("stage3_staging_requests"), 0);
  // Even a Free user with positive (synthetic) wallet balance cannot
  // consume paid inference merely by possessing credits.
  const unentitled = await send("/api/chat",
    {message:single.message,requestId:randomUUID()},sessionHeaders["stage3-free"]);
  assert.ok(unentitled.status >= 400,"Free account must not call paid AI");
  assert.equal(await readCount("provider_usage_events"),0);
  assert.equal(await readCount("provider_budget_reservations"),0);
  assert.equal(await readCount("credit_reservations"),0);
  const duplicates = await Promise.all(Array.from({ length: 3 }, () => send("/api/chat", single, web)));
  assert.ok(duplicates.every(response => response.status === 200 || response.status === 409));
  const accepted = await Promise.all(duplicates.filter(response => response.status === 200).map(response => response.json()));
  assert.equal(accepted.filter(answer => !answer.replayed && answer.saved).length, 1);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 1);
  const replay = await send("/api/chat", single, web);
  assert.equal((await replay.json()).replayed, true);
  assert.equal((await send("/api/chat", single, sessionHeaders["stage3-api"])).status, 200);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 2);

  const multi = await send("/api/chat", { message: "Buat analisis risiko dan strategi untuk bisnis saya.", requestId: randomUUID() }, web);
  assert.equal(multi.status, 200);
  assert.equal((await multi.json()).workflow, "multi-agent");
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 6);

  const webhook = "/api/integrations/telegram/webhook";
  const telegram = { update_id: 42, message: { chat: { id: 77, type: "private" }, from: { id: 77 }, text: single.message } };
  assert.equal((await send(webhook, telegram)).status, 401);
  const telegramHeaders = { "X-Telegram-Bot-Api-Secret-Token": webhookSecret };
  const unlinked = { ...telegram, message: { ...telegram.message, from: { id: 88 } } };
  assert.equal((await send(webhook, unlinked, telegramHeaders)).status, 401);
  const telegramResponse = await send(webhook, telegram, telegramHeaders);
  assert.deepEqual(await telegramResponse.json(), { ok: true });
  assert.equal((await send(webhook, telegram, telegramHeaders)).status, 409);

  const publicHeaders = { Origin: "https://shop.example", Authorization: `Bearer ${fixtureApiKey}` };
  assert.equal((await send("/api/public/chat", single, { ...publicHeaders, Origin: "https://other.example" })).status, 403);
  const publicId = randomBytes(16).toString("hex");
  const publicResponse = await send("/api/public/chat", { ...single, userId: "stage3-web" }, publicHeaders, publicId);
  assert.equal(publicResponse.status, 200);
  assert.equal((await send("/api/public/chat", single, publicHeaders, publicId)).status, 409);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 8);
  const wallets = await db.prepare("SELECT user_id, balance_microcredits FROM credit_accounts ORDER BY user_id").all();
  assert.deepEqual(wallets.results, [
    { user_id: "stage3-api", balance_microcredits: 100000 - 2 * 519 },
    { user_id: "stage3-free", balance_microcredits: 100000 },
    { user_id: "stage3-telegram", balance_microcredits: 100000 - 519 },
    { user_id: "stage3-web", balance_microcredits: 100000 - 5 * 519 }
  ]);

  const unknownBody = { ...single, requestId: randomUUID() };
  const unknown = await send("/api/chat", unknownBody, { ...web, "X-BOR-Stage3-Usage": "unverified" });
  assert.equal(unknown.status, 502);
  assert.equal((await send("/api/chat", unknownBody, web)).status, 409);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_unverified'"), 1);
  assert.equal(await readCount("credit_reservations", "status='reserved'"), 1);
  assert.equal(await readCount("provider_budget_reservations", "status='reserved'"), 1);

  const walletFailure = { ...single, requestId: randomUUID() };
  const partial = await send("/api/chat", walletFailure, { ...web, "X-BOR-Stage3-Usage": "wallet-finalization-failure" });
  assert.equal(partial.status, 502);
  assert.equal((await send("/api/chat", walletFailure, web)).status, 409);
  assert.equal(await readCount("provider_usage_events", "event_kind='usage_measured'"), 9);
  assert.equal(await readCount("credit_reservations", "status='reserved'"), 2);
  assert.equal(await readCount("provider_budget_reservations", "status='reserved'"), 1);
  assert.equal(await readCount("provider_budget_reservations", "status='settled'"), 9);
  // Payment proof reversal must immediately revoke access with no new
  // provider call, budget hold or debit, even if the wallet has credits.
  const before = {
    journal:await readCount("provider_usage_events"),
    budget:await readCount("provider_budget_reservations"),
    wallet:await readCount("credit_reservations")
  };
  await db.prepare("UPDATE verified_plan_payments SET verification_status='refunded' "+
    "WHERE order_id='synthetic-plan-stage3-api'").run();
  const deniedPaidApi = await send("/api/public/chat",
    {...single,requestId:randomUUID()},publicHeaders,randomBytes(16).toString("hex"));
  assert.ok(deniedPaidApi.status >= 400,"Refunded Basic must lose paid API access");
  assert.equal(await readCount("provider_usage_events"),before.journal);
  assert.equal(await readCount("provider_budget_reservations"),before.budget);
  assert.equal(await readCount("credit_reservations"),before.wallet);
  await db.prepare("UPDATE verified_plan_payments SET verification_status='chargeback' "+
    "WHERE order_id='synthetic-plan-stage3-web'").run();
  const deniedWeb = await send("/api/chat",
    {message:single.message,requestId:randomUUID()},web);
  assert.ok(deniedWeb.status >= 400,"Charged-back Pro must lose web paid access");
  assert.equal(await readCount("provider_usage_events"),before.journal);
  assert.equal(await readCount("provider_budget_reservations"),before.budget);
  assert.equal(await readCount("credit_reservations"),before.wallet);
  console.log("PASS: verified synthetic Basic/Pro payments, Free denial, refunds, chargebacks, authenticated routes, isolated wallets, replay rejection and recoverable settlement holds");
} finally {
  await miniflare.dispose();
}

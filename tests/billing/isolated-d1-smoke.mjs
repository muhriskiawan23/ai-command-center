// Runs exclusively against a fresh, temporary Wrangler LOCAL D1 database.
// This file must NEVER accept --remote or reuse the application's wrangler.jsonc.
// No production database, provider credential, or real user data is accessed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "bor-ai-d1-billing-only-"));
const config = join(temp, "wrangler.json");
const persistence = join(temp, "state");
const database = "bor-ai-billing-local-only";
const env = { ...process.env };
for (const key of [
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CF_API_TOKEN",
  "CLOUDFLARE_EMAIL", "CLOUDFLARE_GLOBAL_API_KEY"
]) delete env[key];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function execute(flag, value) {
  const args = [
    "--yes", "wrangler@4", "d1", "execute", database,
    "--local", "--config", config, "--persist-to", persistence,
    "--json", flag, value
  ];
  const raw = execFileSync(npx, args, {
    encoding: "utf8", cwd: process.cwd(), env, timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  const items = JSON.parse(raw);
  assert.ok(Array.isArray(items) && items.length > 0, "Wrangler must return D1 JSON results");
  assert.ok(items.every(item => item.success !== false), "D1 returned an unsuccessful operation");
  return items.flatMap(item => Array.isArray(item.results) ? item.results : []);
}
function sql(statement) { return execute("--command", statement); }
function reject(statement, label) {
  let rejected = false;
  try { sql(statement); } catch { rejected = true; }
  assert.ok(rejected, label + " must fail atomically");
}
function inspect() {
  const rows = sql(`SELECT
    (SELECT balance_microcredits FROM credit_accounts WHERE user_id='fixture') AS balance,
    (SELECT COUNT(*) FROM credit_ledger WHERE user_id='fixture') AS journal_rows,
    (SELECT COUNT(*) FROM credit_reservations WHERE user_id='fixture' AND status='settled') AS settled_wallets,
    (SELECT COALESCE(reserved_micro_usd, -1) FROM provider_budget_daily WHERE day='2026-11-15' AND provider='__global__') AS global_reserved,
    (SELECT COALESCE(spent_micro_usd, -1) FROM provider_budget_daily WHERE day='2026-11-15' AND provider='__global__') AS global_spent,
    (SELECT COUNT(*) FROM provider_budget_reservations WHERE day='2026-11-15') AS provider_reservations`);
  assert.equal(rows.length, 1);
  return rows[0];
}
try {
  mkdirSync(persistence, { recursive: true });
  writeFileSync(config, JSON.stringify({
    name: database,
    compatibility_date: "2026-10-28",
    d1_databases: [{
      binding: "DB", database_name: database,
      database_id: "00000000-0000-4000-8000-000000000001",
      preview_database_id: "billing-only-local-preview"
    }]
  }), { mode: 0o600 });
  // Deliberately explicit: no migrations apply command and no remote binding.
  execute("--file", resolve("migrations/0012_credit_ledger.sql"));
  execute("--file", resolve("migrations/0013_provider_spend_budget.sql"));
  sql(`INSERT INTO credit_accounts VALUES ('fixture',15000,1);
       INSERT INTO provider_budget_limits VALUES ('cloudflare-workers-ai',9000,1);
       INSERT INTO provider_budget_limits VALUES ('tavily',9000,1);
       INSERT INTO provider_budget_limits VALUES ('__global__',9000,1)`);

  // Both reservations must succeed before any paid inference call.
  sql(`INSERT INTO provider_budget_reservations
       (id,day,provider,model,reserved_micro_usd,actual_micro_usd,status,created_at,updated_at)
       VALUES ('ai:fixture-one','2026-11-15','cloudflare-workers-ai','model',8610,NULL,'reserved',1,1)`);
  sql(`INSERT INTO credit_reservations
       (request_id,user_id,reserved_microcredits,settled_microcredits,status,created_at,updated_at)
       VALUES ('fixture-one','fixture',8610,NULL,'reserved',1,1)`);
  let state = inspect();
  assert.equal(state.balance, 6390);
  assert.equal(state.global_reserved, 8610);
  assert.equal(state.global_spent, 0);

  // Duplicate replay cannot reserve, debit, or trigger a second paid call.
  reject(`INSERT INTO provider_budget_reservations
       (id,day,provider,model,reserved_micro_usd,status,created_at,updated_at)
       VALUES ('ai:fixture-one','2026-11-15','cloudflare-workers-ai','model',8610,'reserved',1,1)`,
       "Duplicate provider reservation");
  reject(`INSERT INTO credit_reservations
       (request_id,user_id,reserved_microcredits,status,created_at,updated_at)
       VALUES ('fixture-one','fixture',8610,'reserved',1,1)`,
       "Duplicate customer reservation");

  // Convert maximum reserved exposure to the exact measured synthetic charge.
  sql(`UPDATE provider_budget_reservations SET status='settled', actual_micro_usd=519,
       updated_at=2 WHERE id='ai:fixture-one' AND status='reserved'`);
  sql(`UPDATE credit_reservations SET status='settled', settled_microcredits=519,
       updated_at=2 WHERE request_id='fixture-one' AND status='reserved'`);
  state = inspect();
  assert.equal(state.balance, 14481);
  assert.equal(state.journal_rows, 2);
  assert.equal(state.settled_wallets, 1);
  assert.equal(state.global_reserved, 0);
  assert.equal(state.global_spent, 519);
  assert.equal(state.provider_reservations, 1);

  // A permitted per-provider amount must STILL fail if it breaches the global cap.
  reject(`INSERT INTO provider_budget_reservations
       (id,day,provider,model,reserved_micro_usd,status,created_at,updated_at)
       VALUES ('ai:too-large','2026-11-15','tavily','test',8500,'reserved',3,3)`,
       "Global spend cap");
  state = inspect();
  assert.equal(state.global_spent, 519);
  assert.equal(state.global_reserved, 0);
  assert.equal(state.provider_reservations, 1);

  // Failed global increment must roll back the intermediate per-provider update.
  sql(`INSERT INTO provider_budget_reservations
       (id,day,provider,model,reserved_micro_usd,status,created_at,updated_at)
       VALUES ('ai:small','2026-11-15','tavily','test',200,'reserved',3,3)`);
  state = inspect();
  assert.equal(state.global_reserved, 200);
  assert.equal(state.global_spent, 519);
  assert.equal(state.provider_reservations, 2);

  // A failed terminal rewrite must not double-release reserved credits.
  reject(`UPDATE credit_reservations SET status='released',settled_microcredits=NULL
       WHERE request_id='fixture-one'`, "Double refund");
  assert.equal(inspect().balance, 14481);
  console.log("PASS: isolated Wrangler LOCAL D1 migrations, reservations, global caps, rollback and idempotency");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

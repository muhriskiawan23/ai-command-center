// Stage 2 billing validation against local D1 or one verified *disposable* remote sandbox.
// NEVER runs against the BOR AI production config/database. Synthetic fixtures ONLY.
// Usage: node tests/billing/stage2-d1-proof.mjs --local
//        BOR_AI_D1_SANDBOX_DB_NAME=... BOR_AI_D1_SANDBOX_DB_ID=... \
//        BOR_AI_D1_SANDBOX_TOKEN=... BOR_AI_D1_SANDBOX_ACCOUNT_ID=... \
//        node tests/billing/stage2-d1-proof.mjs --remote
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const execAsync = promisify(execFile);
const mode = process.argv[2];
assert.ok(["--local", "--remote"].includes(mode) && process.argv.length === 3,
  "Explicit --local or --remote required");
const isRemote = mode === "--remote";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prod = JSON.parse(readFileSync(resolve("wrangler.jsonc"), "utf8"));
const prodIds = new Set((prod.d1_databases || []).map(x => x.database_id));
const prodNames = new Set((prod.d1_databases || []).map(x => x.database_name));
const database = isRemote ? process.env.BOR_AI_D1_SANDBOX_DB_NAME : "bor-ai-stage2-local-only";
const databaseId = isRemote ? process.env.BOR_AI_D1_SANDBOX_DB_ID : randomUUID();
if (isRemote) {
  assert.match(database || "", /^bor-ai-billing-sbx-[a-z0-9-]{6,40}$/,
    "Dedicated remote sandbox database name required");
  assert.match(databaseId || "", uuid, "Dedicated sandbox database UUID required");
  assert.ok(!prodIds.has(databaseId) && !prodNames.has(database),
    "Production D1 database ID or name is forbidden");
  assert.ok(process.env.BOR_AI_D1_SANDBOX_TOKEN?.length > 15 &&
    /^[a-f0-9]{32}$/i.test(process.env.BOR_AI_D1_SANDBOX_ACCOUNT_ID || ""),
    "A separate, narrowly scoped sandbox credential is required");
}
const temp = mkdtempSync(join(tmpdir(), "bor-ai-stage2-proof-"));
const config = join(temp, "wrangler.json");
const persistence = join(temp, "local-state");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const env = { ...process.env, CLOUDFLARE_SEND_METRICS: "false" };
// Never pass ambient account credentials to local test, or production defaults
// to remote test. The latter exclusively uses named sandbox-only credentials.
for (const key of ["CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID",
                  "CF_API_TOKEN","CLOUDFLARE_GLOBAL_API_KEY","CLOUDFLARE_EMAIL"])
  delete env[key];
if (isRemote) {
  env.CLOUDFLARE_API_TOKEN = process.env.BOR_AI_D1_SANDBOX_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID = process.env.BOR_AI_D1_SANDBOX_ACCOUNT_ID;
}
delete env.BOR_AI_D1_SANDBOX_TOKEN;
const timeLimit = isRemote ? 90000 : 120000;
function args(flag, value) {
  return ["--yes", "wrangler@4", "d1", "execute", database,
    isRemote ? "--remote" : "--local",
    "--config", config, ...(isRemote ? [] : ["--persist-to",persistence]),
    "--json", "--yes",flag,value];
}
function resultOf(raw) {
  const data=JSON.parse(raw);
  assert.ok(Array.isArray(data) && data.length>0 && data.every(x=>x.success!==false),
    "D1 operation must return successful JSON");
  return data.flatMap(x=>x.results ?? []);
}
function run(a) {
  return execFileSync(npx,a,{
    env,cwd:process.cwd(),encoding:"utf8",timeout:timeLimit,maxBuffer:4*1024*1024,
    stdio:["ignore","pipe","pipe"]
  });
}
function sql(s) {return resultOf(run(args("--command",s)));}
async function parallelSql(s) {
  try {
    const {stdout}=await execAsync(npx,args("--command",s),{
      env,cwd:process.cwd(),timeout:timeLimit,maxBuffer:4*1024*1024
    });
    resultOf(stdout);
    return true;
  } catch(e) {
    // Rejected SQL is an expected outcome for some parallel reservations;
    // an auth, DNS, HTTP or CLI failure is not a valid budget-rejection proof.
    const out=String(e?.stderr||"")+"\n"+String(e?.stdout||"");
    if (/insufficient_credit_balance|global_daily_budget_exceeded_or_unconfigured|provider_daily_budget_exceeded_or_unconfigured/i.test(out))
      return false;
    throw new Error("D1 concurrent attempt unavailable or rejected for an unexpected reason");
  }
}
// Multiple independent CLI processes contending for one local SQLite file can
// fail with SQLITE_BUSY before any financial trigger is reached. Verify local
// invariants sequentially; only --remote is a genuine concurrent D1 test.
async function runAttempts(statements) {
  if (isRemote) return Promise.all(statements.map(parallelSql));
  const out = [];
  for (const statement of statements) out.push(await parallelSql(statement));
  return out;
}
function denied(s,expected,label) {
  try { sql(s); } catch(e) {
    const out=String(e?.stderr||"")+"\n"+String(e?.stdout||"");
    assert.ok(out.includes(expected),label+" must fail with expected D1 constraint, not a network/auth error");
    return;
  }
  assert.fail(label+" was unexpectedly accepted");
}
function single(s) {
  const data=sql(s);
  assert.equal(data.length,1,"Expected a single D1 result");
  return data[0];
}
function state(day) {
  return single(`SELECT
    (SELECT balance_microcredits FROM credit_accounts WHERE user_id='fixture') AS balance,
    (SELECT balance_microcredits FROM credit_accounts WHERE user_id='parallel') AS parallel_balance,
    (SELECT COALESCE(reserved_micro_usd,-1) FROM provider_budget_daily WHERE day='${day}' AND provider='__global__') AS reserved,
    (SELECT COALESCE(spent_micro_usd,-1) FROM provider_budget_daily WHERE day='${day}' AND provider='__global__') AS spent,
    (SELECT COUNT(*) FROM credit_reservations WHERE user_id='fixture' AND status='reserved') AS held_wallets`);
}
function budget(request,day,amount,timestamp) {
  return `INSERT INTO provider_budget_reservations
    (id,day,provider,model,reserved_micro_usd,status,created_at,updated_at)
    VALUES ('ai:${request}','${day}','cloudflare-workers-ai','synthetic',${amount},'reserved',${timestamp},${timestamp})`;
}
function wallet(request,user,amount,timestamp) {
  return `INSERT INTO credit_reservations
    (request_id,user_id,reserved_microcredits,status,created_at,updated_at)
    VALUES ('${request}','${user}',${amount},'reserved',${timestamp},${timestamp})`;
}
function ensureFreshTarget() {
  const existing=sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  assert.equal(existing.length,0,"Proof requires a NEW EMPTY sandbox database, never an existing app database");
}
function verifyRemoteIdentity() {
  const raw=run(["--yes","wrangler@4","d1","list","--json"]);
  const payload=JSON.parse(raw);
  assert.ok(Array.isArray(payload),"D1 list response must be an array");
  const entry=payload.find(x=>x.uuid===databaseId || x.id===databaseId);
  assert.ok(entry && entry.name===database,
    "Remote DB ID and exact sandbox name must match Cloudflare account inventory");
  assert.ok(!prodIds.has(entry.uuid||entry.id), "Production D1 ID forbidden");
}
try {
  mkdirSync(persistence,{recursive:true});
  writeFileSync(config,JSON.stringify({
    name:"bor-ai-billing-stage2-proof-only",
    compatibility_date:"2026-10-28",
    d1_databases:[{binding:"BILLING_TEST_ONLY",database_name:database,
      database_id:databaseId,...(!isRemote?{preview_database_id:"stage2-only-local"}:{})}]
  }),{mode:0o600});
  if(isRemote)verifyRemoteIdentity();
  ensureFreshTarget();
  const day=new Date().toISOString().slice(0,10);
  const now=Math.floor(Date.now()/1000);
  resultOf(run(args("--file",resolve("migrations/0012_credit_ledger.sql"))));
  resultOf(run(args("--file",resolve("migrations/0013_provider_spend_budget.sql"))));
  sql(`INSERT INTO credit_accounts VALUES ('fixture',25000,${now});
    INSERT INTO credit_accounts VALUES ('parallel',10000,${now});
    INSERT INTO provider_budget_limits VALUES ('cloudflare-workers-ai',9000,${now});
    INSERT INTO provider_budget_limits VALUES ('__global__',9000,${now})`);

  sql(budget("one",day,8610,now));
  sql(wallet("one","fixture",8610,now));
  assert.equal(state(day).balance,16390);
  // Raise caps only inside this fresh disposable database so BEFORE INSERT
  // cap triggers do not mask the UNIQUE replay guard we intend to prove.
  sql("UPDATE provider_budget_limits SET daily_cap_micro_usd=20000");
  denied(budget("one",day,8610,now),"UNIQUE","Duplicate budget");
  denied(wallet("one","fixture",8610,now),"UNIQUE","Duplicate wallet");
  assert.equal(state(day).reserved,8610,"Duplicate insert must roll back its trigger effects");
  sql("UPDATE provider_budget_limits SET daily_cap_micro_usd=9000");

  sql("UPDATE provider_budget_reservations SET status='settled', actual_micro_usd=519 WHERE id='ai:one' AND status='reserved'");
  sql("UPDATE credit_reservations SET status='settled',settled_microcredits=519 WHERE request_id='one' AND status='reserved'");
  assert.equal(state(day).balance,24481);
  assert.equal(state(day).spent,519);
  assert.equal(state(day).reserved,0);

  // A release is safe ONLY when the model was never dispatched; no provider
  // response is guessed from a timeout in this test.
  sql(wallet("refund-before-invoke","fixture",1000,now));
  assert.equal(state(day).balance,23481);
  sql("UPDATE credit_reservations SET status='released' WHERE request_id='refund-before-invoke' AND status='reserved'");
  assert.equal(state(day).balance,24481);
  denied("UPDATE credit_reservations SET status='released' WHERE request_id='refund-before-invoke'",
    "invalid_reservation_transition","Double refund");

  denied(wallet("insufficient","fixture",30000,now),
    "insufficient_credit_balance","Insufficient funds");
  assert.equal(state(day).balance,24481);

  // Timeout simulation: the call might have incurred upstream charges;
  // hold both allocations and verify that they remain reserved.
  sql(budget("timeout",day,500,now-7200));
  sql(wallet("timeout","fixture",500,now-7200));
  assert.equal(state(day).held_wallets,1);
  assert.equal(state(day).balance,23981);
  const held=single("SELECT status FROM provider_budget_reservations WHERE id='ai:timeout'");
  assert.equal(held.status,"reserved");

  // Artificially lower the cap after initial settlements. Exactly four
  // simultaneous 600-microUSD reservations may fit remaining global budget.
  sql("UPDATE provider_budget_limits SET daily_cap_micro_usd=3500 WHERE provider='__global__'");
  const budgetAttempts=Array.from({length:8},(_,i)=>budget("parallel-budget-"+i,day,600,now));
  const results=await runAttempts(budgetAttempts);
  assert.equal(results.filter(Boolean).length,4,"Remote D1 global cap must be atomic across requests");
  const walletAttempts=Array.from({length:8},(_,i)=>wallet("parallel-wallet-"+i,"parallel",3000,now));
  const wallets=await runAttempts(walletAttempts);
  assert.equal(wallets.filter(Boolean).length,3,"Remote D1 wallet debit must be atomic");

  const final=state(day);
  assert.equal(final.balance,23981);
  assert.equal(final.parallel_balance,1000);
  assert.equal(final.reserved,2900);
  assert.equal(final.spent,519);
  assert.equal(final.held_wallets,1);

  const journal=single(`SELECT
    (SELECT COUNT(*) FROM credit_ledger WHERE reference_id='one') AS settled_journal,
    (SELECT COALESCE(SUM(delta_microcredits),0) FROM credit_ledger WHERE reference_id='one') AS paid_debit,
    (SELECT COUNT(*) FROM credit_ledger WHERE reference_id='refund-before-invoke') AS refunded_journal,
    (SELECT COALESCE(SUM(delta_microcredits),0) FROM credit_ledger WHERE reference_id='refund-before-invoke') AS refunded_net`);
  assert.equal(journal.settled_journal,2);
  assert.equal(journal.paid_debit,-519);
  assert.equal(journal.refunded_journal,2);
  assert.equal(journal.refunded_net,0);
  console.log(JSON.stringify({
    result:"PASS",mode:isRemote?"remote_disposable_D1":"local_disposable_D1",
    checks:["fresh_db_guard","duplicate_replay","measured_settlement","refund_once",
      "insufficient_funds","unknown_timeout_holds","parallel_budget_cap",
      "parallel_wallet_debit","credit_journal_reconciliation"],
    requestExecution:isRemote?"concurrent_remote":"sequential_local",
    parallelBudgetAllowed:results.filter(Boolean).length,
    parallelWalletAllowed:wallets.filter(Boolean).length,
    simulatedProviderCalls:0,
    productionDatabaseTouched:false
  }));
} finally {
  // Deletes only temporary local config + local SQLite files, NEVER remote D1.
  rmSync(temp,{recursive:true,force:true});
}

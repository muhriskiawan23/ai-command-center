import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertFreshSandboxTables, classifyStage2SandboxSchema } from "./billing/stage2-schema-guard.mjs";

const prod = JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
const existing = prod.d1_databases?.[0];
assert.ok(existing?.database_id && existing?.database_name);
const runner = new URL("./billing/stage2-d1-proof.mjs",import.meta.url);
function attempt(options,overrideEnv={}) {
  const env={...process.env,...overrideEnv};
  for (const key of [
    "CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID","CF_API_TOKEN",
    "CLOUDFLARE_EMAIL","CLOUDFLARE_GLOBAL_API_KEY",
    "BOR_AI_D1_SANDBOX_DB_NAME","BOR_AI_D1_SANDBOX_DB_ID",
    "BOR_AI_D1_SANDBOX_TOKEN","BOR_AI_D1_SANDBOX_ACCOUNT_ID"
  ]) {
    if (!Object.hasOwn(overrideEnv,key)) delete env[key];
  }
  return spawnSync(process.execPath,[runner.pathname,...options],{
    env,encoding:"utf8",timeout:5000
  });
}
const sandbox={
  BOR_AI_D1_SANDBOX_DB_NAME:"bor-ai-billing-sbx-safety-fixture",
  BOR_AI_D1_SANDBOX_DB_ID:"11111111-1111-4111-8111-111111111111",
  BOR_AI_D1_SANDBOX_TOKEN:"synthetic-never-valid-token-000000",
  BOR_AI_D1_SANDBOX_ACCOUNT_ID:"0123456789abcdef0123456789abcdef"
};

test("remote empty D1 accepts only Cloudflare reserved metadata, never application tables",()=>{
  assert.doesNotThrow(()=>assertFreshSandboxTables([],true));
  assert.doesNotThrow(()=>assertFreshSandboxTables([{name:"_cf_KV"}],true));
  for(const names of [
    [{name:"users"}],
    [{name:"_cf_KV"},{name:"credit_accounts"}],
    [{name:"_cf_KV"},{name:"d1_migrations"}],
    [{name:"_cf_KV"},{name:"_cf_kv"}],
    [{name:"_cf_KV"},{}]
  ]) {
    assert.throws(()=>assertFreshSandboxTables(names,true),
      /NEW EMPTY sandbox database/);
  }
  assert.throws(()=>assertFreshSandboxTables([{name:"_cf_KV"}],false),
    /NEW EMPTY sandbox database/);
});

test("Stage 2 resumes only exact migration-only schema, rejects any added schema",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    const inventory=()=>db.prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
    ).all();
    assert.equal(classifyStage2SandboxSchema(inventory(),true),"empty");
    db.exec(readFileSync(new URL("../migrations/0012_credit_ledger.sql",import.meta.url),"utf8"));
    assert.equal(classifyStage2SandboxSchema(inventory(),true),"credit_migrated");
    db.exec(readFileSync(new URL("../migrations/0013_provider_spend_budget.sql",import.meta.url),"utf8"));
    assert.equal(classifyStage2SandboxSchema(inventory(),true),"both_migrated");
    db.exec("CREATE TABLE unrelated_app_data(id TEXT)");
    assert.throws(()=>classifyStage2SandboxSchema(inventory(),true),/differs from exact Stage 2/);
  } finally { db.close(); }
});

test("Stage 2 schema guard rejects tampered migration definitions",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    const inventory=()=>db.prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
    ).all();
    db.exec(readFileSync(new URL("../migrations/0012_credit_ledger.sql",import.meta.url),"utf8"));
    db.exec("ALTER TABLE credit_accounts ADD COLUMN unexpected TEXT");
    assert.throws(()=>classifyStage2SandboxSchema(inventory(),true),/differs from exact Stage 2/);
  } finally { db.close(); }
});

test("Stage 2 ignores only exact remote protected D1 system table",()=>{
  const system={type:"table",name:"_cf_KV",sql:"CREATE TABLE _cf_KV(key TEXT)"};
  assert.equal(classifyStage2SandboxSchema([system],true),"empty");
  assert.throws(()=>classifyStage2SandboxSchema([system],false),/Unexpected reserved D1 metadata schema/);
  assert.throws(()=>classifyStage2SandboxSchema([
    system,{type:"table",name:"_cf_kv",sql:"CREATE TABLE _cf_kv(key TEXT)"}
  ],true),/differs from exact Stage 2/);
});

test("stage 2 proof refuses implicit mode or unknown arguments",()=>{
  for(const args of [[],["--unknown"],["--remote","--local"]]){
    const result=attempt(args);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Explicit --local or --remote required/);
  }
});
test("remote D1 proof rejects missing dedicated credentials before remote calls",()=>{
  const result=attempt(["--remote"],{
    BOR_AI_D1_SANDBOX_DB_NAME:sandbox.BOR_AI_D1_SANDBOX_DB_NAME,
    BOR_AI_D1_SANDBOX_DB_ID:sandbox.BOR_AI_D1_SANDBOX_DB_ID
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/separate, narrowly scoped sandbox credential/);
});
test("remote D1 proof accepts a six-character sandbox suffix before credential checks",()=>{
  const result=attempt(["--remote"],{
    BOR_AI_D1_SANDBOX_DB_NAME:"bor-ai-billing-sbx-stage2",
    BOR_AI_D1_SANDBOX_DB_ID:sandbox.BOR_AI_D1_SANDBOX_DB_ID
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/separate, narrowly scoped sandbox credential/);
  assert.doesNotMatch(result.stderr,/Dedicated remote sandbox database name required/);
});
test("remote D1 proof refuses production database identity",()=>{
  for(const dimensions of [
    {BOR_AI_D1_SANDBOX_DB_NAME:existing.database_name},
    {BOR_AI_D1_SANDBOX_DB_ID:existing.database_id}
  ]){
    const result=attempt(["--remote"],{...sandbox,...dimensions});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Production D1 database ID or name is forbidden|Dedicated remote sandbox database name required/);
    assert.doesNotMatch(result.stderr,/CLOUDFLARE_API_TOKEN=/);
  }
});
test("remote D1 proof validates sandbox-specific naming before any cloud activity",()=>{
  const bad = attempt(["--remote"],{...sandbox,BOR_AI_D1_SANDBOX_DB_NAME:"bor-ai-chat"});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/Dedicated remote sandbox database name required/);
});

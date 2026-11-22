import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  reserveProviderSpend, settleProviderSpend, providerBudgetDay, providerSpendBudget
} from "../src/provider-spend-budget.js";
import { runReservedBillableInference } from "../src/billable-inference-gate.js";

const schema = readFileSync(new URL("../migrations/0013_provider_spend_budget.sql", import.meta.url),"utf8");
const credit = readFileSync(new URL("../migrations/0012_credit_ledger.sql", import.meta.url),"utf8");
const nowMs=Date.UTC(2026,10,15,10,0,0);
function setup(t, limits = [["tavily",400n],["cloudflare-workers-ai",9000n],["__global__",9500n]]) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  sqlite.exec(schema);
  sqlite.exec(credit);
  const cap=sqlite.prepare("INSERT INTO provider_budget_limits(provider,daily_cap_micro_usd,updated_at) VALUES (?,?,1)");
  for(const [provider,amount] of limits) cap.run(provider,Number(amount));
  sqlite.prepare("INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES ('u',15000,1)").run();
  const env={DB:{prepare(sql){const statement=sqlite.prepare(sql);return{bind(...args){return{
    first:async()=>statement.get(...args),run:async()=>({meta:{changes:statement.run(...args).changes}})
  }}}}}};
  const state=(provider,day="2026-11-15")=>sqlite.prepare(
    "SELECT reserved_micro_usd AS reserved,spent_micro_usd AS spent FROM provider_budget_daily WHERE day=? AND provider=?"
  ).get(day,provider);
  const ledger=()=>sqlite.prepare("SELECT delta_microcredits AS n FROM credit_ledger").all().map(x=>x.n).sort((a,b)=>a-b);
  const balance=()=>sqlite.prepare("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id='u'").get().n;
  return {sqlite,env,state,ledger,balance};
}
const reserve=(env,id,provider="cloudflare-workers-ai",maximumMicroUsd=1000n,at=nowMs)=>
  reserveProviderSpend(env,{id,provider,model:"model",maximumMicroUsd,nowMs:at});
const settle=(env,id,actualMicroUsd=300n,at=nowMs)=>
  settleProviderSpend(env,{id,actualMicroUsd,nowMs:at});

test("provider and global caps atomically reserve, settle and prevent double settlement",async t=>{
  const x=setup(t);
  assert.equal((await reserve(x.env,"r1")).ok,true);
  assert.deepEqual({...x.state("cloudflare-workers-ai")},{reserved:1000,spent:0});
  assert.deepEqual({...x.state("__global__")},{reserved:1000,spent:0});
  assert.equal((await settle(x.env,"r1")).ok,true);
  assert.deepEqual({...x.state("cloudflare-workers-ai")},{reserved:0,spent:300});
  assert.deepEqual({...x.state("__global__")},{reserved:0,spent:300});
  assert.equal((await settle(x.env,"r1")).ok,false);
  assert.equal((await reserve(x.env,"r1")).ok,false);
  assert.deepEqual({...x.state("__global__")},{reserved:0,spent:300});
});
test("no approved provider cap or missing global cap fails closed with no counters",async t=>{
  const x=setup(t,[["cloudflare-workers-ai",10000n]]);
  assert.equal((await reserve(x.env,"missing-global")).ok,false);
  assert.equal(x.state("__global__"),undefined);
  assert.equal(x.state("cloudflare-workers-ai"),undefined);
  assert.equal((await reserve(x.env,"no-provider","unapproved-provider")).ok,false);
  assert.equal(x.sqlite.prepare("SELECT count(*) AS n FROM provider_budget_reservations").get().n,0);
});
test("global daily budget applies across multiple providers, without bypass",async t=>{
  const x=setup(t,[["cloudflare-workers-ai",9000n],["tavily",9000n],["__global__",1200n]]);
  assert.equal((await reserve(x.env,"one","cloudflare-workers-ai",1000n)).ok,true);
  assert.equal((await reserve(x.env,"two","tavily",250n)).ok,false);
  assert.equal((await reserve(x.env,"two","tavily",200n)).ok,true);
  assert.equal((await reserve(x.env,"three","cloudflare-workers-ai",1n)).ok,false);
  assert.deepEqual({...x.state("__global__")},{reserved:1200,spent:0});
});
test("individual provider budget applies when global still has room",async t=>{
  const x=setup(t,[["cloudflare-workers-ai",1100n],["tavily",2000n],["__global__",5000n]]);
  assert.equal((await reserve(x.env,"one","cloudflare-workers-ai",1000n)).ok,true);
  assert.equal((await reserve(x.env,"two","cloudflare-workers-ai",101n)).ok,false);
  assert.equal((await reserve(x.env,"two","tavily",1000n)).ok,true);
  assert.equal(x.state("cloudflare-workers-ai").reserved,1000);
  assert.equal(x.state("__global__").reserved,2000);
});
test("failed settlements, direct terminal insertion and mutable budget history are rejected",async t=>{
  const x=setup(t);
  await reserve(x.env,"one");
  assert.equal((await settle(x.env,"one",1001n)).ok,false);
  assert.deepEqual({...x.state("__global__")},{reserved:1000,spent:0});
  assert.throws(()=>x.sqlite.prepare("DELETE FROM provider_budget_reservations WHERE id='one'").run(),/forbidden/);
  assert.throws(()=>x.sqlite.prepare("UPDATE provider_budget_reservations SET reserved_micro_usd=1 WHERE id='one'").run(),/invalid_provider_budget/);
  assert.throws(()=>x.sqlite.prepare("INSERT INTO provider_budget_reservations VALUES ('fake','2026-11-15','cloudflare-workers-ai','model',1,0,'settled',1,1)").run(),/invalid_provider_budget/);
  assert.equal((await settle(x.env,"one",800n)).ok,true);
  assert.deepEqual({...x.state("__global__")},{reserved:0,spent:800});
});
test("zero-cost pre-inference cancellation settles budget to zero without model dispatch",async t=>{
  const x=setup(t);
  await reserve(x.env,"aborted");
  assert.equal((await settle(x.env,"aborted",0n)).ok,true);
  assert.deepEqual({...x.state("__global__")},{reserved:0,spent:0});
});
test("same provider daily budget resets at 00:00 UTC, not local Indonesian midnight",async t=>{
  const x=setup(t);
  assert.equal(providerBudgetDay(Date.UTC(2026,10,15,23,59)), "2026-11-15");
  assert.equal(providerBudgetDay(Date.UTC(2026,10,16,0,0)), "2026-11-16");
  await reserve(x.env,"day1","cloudflare-workers-ai",9000n,Date.UTC(2026,10,15,23,59));
  await reserve(x.env,"day2","cloudflare-workers-ai",9000n,Date.UTC(2026,10,16,0,0));
  assert.equal(x.state("__global__","2026-11-15").reserved,9000);
  assert.equal(x.state("__global__","2026-11-16").reserved,9000);
});
test("concurrent reservations cannot exceed a single global budget",async t=>{
  const x=setup(t,[["cloudflare-workers-ai",10000n],["__global__",1000n]]);
  const results=await Promise.all(Array.from({length:20},(_,i)=>reserve(x.env,"req-"+i,"cloudflare-workers-ai",250n)));
  assert.equal(results.filter(x=>x.ok).length,4);
  assert.equal(x.state("__global__").reserved,1000);
  assert.equal(x.sqlite.prepare("SELECT count(*) AS n FROM provider_budget_reservations").get().n,4);
});
test("budget adapter composes with the real credit ledger and measured AI response",async t=>{
  const x=setup(t,[["cloudflare-workers-ai",9000n],["__global__",9000n]]);
  const tariff={
    approved:true,version:"sandbox-only",provider:"cloudflare-workers-ai",model:"model",
    inputRateMicroUsdPerMillion:293000n,outputRateMicroUsdPerMillion:2253000n,
    creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  let invoked=0;
  const result=await runReservedBillableInference({
    env:x.env,userId:"u",requestId:"bill-one",tariff,maxInputTokens:24000,maxOutputTokens:700,
    providerBudget:providerSpendBudget(x.env),
    invokeModel:async()=>{invoked++;return{response:"synthetic",usage:{prompt_tokens:1000,completion_tokens:100}}}
  });
  assert.equal(result.ok,true);
  assert.equal(invoked,1);
  assert.equal(result.providerCostMicroUsd,519n);
  assert.equal(x.balance(),15000-519);
  assert.deepEqual(x.ledger(),[-8610,8091]);
  // The billable gate records the real UTC day; do not assume the test's
  // fixed fixture day when the CI clock advances to a later date.
  const recordedDay=x.sqlite.prepare(
    "SELECT day FROM provider_budget_reservations WHERE id='ai:bill-one'"
  ).get()?.day;
  assert.match(recordedDay,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual({...x.state("__global__",recordedDay)},{reserved:0,spent:519});
  const repeat=await runReservedBillableInference({
    env:x.env,userId:"u",requestId:"bill-one",tariff,maxInputTokens:24000,maxOutputTokens:700,
    providerBudget:providerSpendBudget(x.env),invokeModel:async()=>{invoked++;}
  });
  assert.equal(repeat.ok,false);assert.equal(invoked,1);
});

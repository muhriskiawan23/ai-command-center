// Inactive Stage 3 per-case triage against the real proposed SQL migrations.
// All records and provider evidence are synthetic and local; never live billing.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveCredits, finalizeCredits } from "../src/credit-ledger.js";
import { reserveProviderSpend, settleProviderSpend } from "../src/provider-spend-budget.js";
import { appendProviderUsageEvent } from "../src/provider-usage-journal.js";
import { inspectStage3RecoveryCase } from "../src/stage3-operator-case-triage.js";

const requestId="synthetic-case-1";
const userId="synthetic-owner";
const provider="cloudflare-workers-ai";
const model="@cf/synthetic-case-model";
const now=1735000000000;
const tariff={
  approved:true,version:"test-snapshot-v1",provider,model,
  inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n
};

function setup(t){
  const sql=new DatabaseSync(":memory:");
  t.after(()=>sql.close());
  for (const name of ["0012_credit_ledger","0013_provider_spend_budget","0014_provider_usage_journal"])
    sql.exec(readFileSync(new URL("../migrations/"+name+".sql",import.meta.url),"utf8"));
  sql.prepare("INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES (?,?,1)").run(userId,100000);
  for (const p of [provider,"__global__"])
    sql.prepare("INSERT INTO provider_budget_limits(provider,daily_cap_micro_usd,updated_at) VALUES (?,?,1)").run(p,100000);
  let reads=0,writes=0;
  const stmt=(query,params=[])=>({
    bind(...a){return stmt(query,a);},
    async first(){reads++;return sql.prepare(query).get(...params);},
    async run(){writes++;return {meta:{changes:sql.prepare(query).run(...params).changes}};}
  });
  const env={DB:{prepare(query){return stmt(query);}}};
  async function holds(){
    assert.equal((await reserveProviderSpend(env,{id:"ai:"+requestId,provider,model,maximumMicroUsd:9000n,nowMs:now})).ok,true);
    assert.equal((await reserveCredits(env,{userId,requestId,amountMicrocredits:9000n,now:Math.floor(now/1000)})).ok,true);
  }
  async function journal(kind, attemptId="attempt-a"){
    const event={attemptId,requestId,kind,provider,model,rateVersion:tariff.version,nowMs:now+1000};
    if(kind==="usage_measured") Object.assign(event,{usage:{prompt_tokens:1000,completion_tokens:100},tariff});
    assert.equal((await appendProviderUsageEvent(env,event)).ok,true);
  }
  async function budget(amount=519n){
    assert.equal((await settleProviderSpend(env,{id:"ai:"+requestId,actualMicroUsd:amount,nowMs:now+2000})).ok,true);
  }
  async function wallet(amount=519n){
    assert.equal((await finalizeCredits(env,{userId,requestId,settledMicrocredits:amount,now:Math.floor(now/1000)+2})).ok,true);
  }
  async function release(){
    assert.equal((await finalizeCredits(env,{userId,requestId,now:Math.floor(now/1000)+2})).ok,true);
  }
  async function inspect(){
    const before=writes;
    const value=await inspectStage3RecoveryCase(env,{requestId});
    assert.equal(writes,before,"inspector must never write to D1");
    assert.equal(value.operatorActionAuthorized,false);
    assert.equal(value.providerInvoiceVerified,false);
    const text=JSON.stringify(value);
    for(const sensitive of [requestId,userId,"attempt-a",provider,model])
      assert.equal(text.includes(sensitive),false,"no per-case secrets or IDs leaked");
    return value;
  }
  return {sql,env,holds,journal,budget,wallet,release,inspect,stats:()=>({reads,writes})};
}

test("no case records fail closed but return no account IDs",async t=>{
  const x=setup(t);
  const output=await x.inspect();
  assert.equal(output.reviewClass,"escalate");
  assert.deepEqual([...output.reasons].sort(),["provider_budget_record_missing","wallet_record_missing"].sort());
});
test("valid pre-dispatch dual holds are candidates ONLY for independent human proof",async t=>{
  const x=setup(t);await x.holds();
  const a=await x.inspect();
  assert.equal(a.reviewClass,"candidate_verified_no_dispatch_review");
  assert.equal(a.operatorActionAuthorized,false);
  assert.equal(a.dispatchedAttempts,0);
});
test("measured dual holds require provider-first independent review",async t=>{
  const x=setup(t);await x.holds();
  await x.journal("dispatched");await x.journal("usage_measured");
  const a=await x.inspect();
  assert.equal(a.reviewClass,"candidate_provider_then_wallet_review");
  assert.equal(a.measuredAttempts,1);
  assert.equal(a.unresolvedAttempts,0);
});
test("provider settled while wallet held is a wallet-review candidate, never an authorized action",async t=>{
  const x=setup(t);await x.holds();
  await x.journal("dispatched");await x.journal("usage_measured");await x.budget();
  const before=await x.inspect();
  assert.equal(before.reviewClass,"candidate_wallet_finalization_review");
  const b=x.sql.prepare("SELECT status FROM credit_reservations WHERE request_id=?").get(requestId);
  assert.equal(b.status,"reserved");
  await x.wallet();
  assert.equal((await x.inspect()).reviewClass,"no_financial_recovery");
});
for (const kind of ["outcome_unknown","usage_unverified"]){
  test("no measured provider evidence "+kind+" is escalated without mutation",async t=>{
    const x=setup(t);await x.holds();await x.journal("dispatched");await x.journal(kind);
    const a=await x.inspect();
    assert.equal(a.reviewClass,"escalate");
    assert.ok(a.reasons.includes("unverified_provider_attempt"));
    assert.ok(a.reasons.includes("no_authoritative_measured_usage"));
  });
}
test("a later measured event for same attempt resolves its earlier uncertainty but never verifies invoices",async t=>{
  const x=setup(t);await x.holds();
  await x.journal("dispatched");
  await x.journal("outcome_unknown");
  await x.journal("usage_measured");
  const a=await x.inspect();
  assert.equal(a.reviewClass,"candidate_provider_then_wallet_review");
  assert.equal(a.providerInvoiceVerified,false);
});
test("second dispatched unmeasured attempt blocks recovery even if another attempt has measured tokens",async t=>{
  const x=setup(t);await x.holds();
  await x.journal("dispatched");await x.journal("usage_measured");
  await x.journal("dispatched","attempt-b");
  const a=await x.inspect();
  assert.equal(a.reviewClass,"escalate");
  assert.ok(a.reasons.includes("unverified_provider_attempt"));
  assert.ok(a.reasons.includes("multi_attempt_invoice_review"));
});
test("two measured retries still require independent invoice aggregation",async t=>{
  const x=setup(t);await x.holds();
  await x.journal("dispatched");await x.journal("usage_measured");
  await x.journal("dispatched","attempt-b");await x.journal("usage_measured","attempt-b");
  const a=await x.inspect();
  assert.equal(a.reviewClass,"escalate");
  assert.ok(a.reasons.includes("multi_attempt_invoice_review"));
  assert.equal(a.measuredAttempts,2);
});
test("provider cost settled wrong or zero after dispatch always escalates",async t=>{
  const x=setup(t);await x.holds();await x.journal("dispatched");await x.journal("usage_measured");await x.budget(520n);
  assert.ok((await x.inspect()).reasons.includes("provider_measured_cost_mismatch"));
  const y=setup(t);await y.holds();await y.journal("dispatched");await y.journal("usage_measured");await y.budget(0n);
  const b=await y.inspect();
  assert.ok(b.reasons.includes("zero_provider_cost_after_dispatch"));
  assert.ok(b.reasons.includes("provider_measured_cost_mismatch"));
});
test("released customer credit after provider invocation must never look cleared",async t=>{
  const x=setup(t);await x.holds();await x.journal("dispatched");await x.journal("usage_measured");
  await x.budget();await x.release();
  const a=await x.inspect();
  assert.equal(a.reviewClass,"escalate");
  assert.ok(a.reasons.includes("customer_credit_released_after_dispatch"));
  assert.ok(a.reasons.includes("customer_credit_released_with_provider_cost"));
});
test("wallet settled before provider budget is classified as unsafe",async t=>{
  const x=setup(t);await x.holds();await x.journal("dispatched");await x.journal("usage_measured");await x.wallet();
  assert.ok((await x.inspect()).reasons.includes("customer_credit_settled_without_provider"));
});
test("read-only inspector rejects invalid request IDs, DB failures and incomplete counters",async t=>{
  const x=setup(t);
  await assert.rejects(inspectStage3RecoveryCase(x.env,{requestId:"bad request"}),/request ID/);
  await assert.rejects(inspectStage3RecoveryCase({},{requestId}),/D1 binding/);
  await assert.rejects(inspectStage3RecoveryCase({DB:{prepare(){throw Error("offline")}}},{requestId}),/offline/);
  await assert.rejects(inspectStage3RecoveryCase({DB:{prepare(){return{bind(){return{first:async()=>({})}}}}}},{requestId}),/snapshot/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {reserveCredits,finalizeCredits} from "../src/credit-ledger.js";
import {reserveProviderSpend,settleProviderSpend,providerSpendBudget} from "../src/provider-spend-budget.js";
import {appendProviderUsageEvent} from "../src/provider-usage-journal.js";
import {runJournaledInferencePrototype} from "../src/stage3-journaled-inference.js";
import {inspectStage3CrossLedgerReconciliation} from "../src/stage3-cross-ledger-reconciliation.js";

const tariff={
  approved:true,version:"fixture-only",provider:"cloudflare-workers-ai",
  model:"synthetic-test",inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n,
  creditNumerator:1n,creditDenominator:1n,
  maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
};
function setup(t){
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  for(const file of ["0012_credit_ledger.sql","0013_provider_spend_budget.sql",
    "0014_provider_usage_journal.sql"])
    db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
  db.exec("INSERT INTO credit_accounts VALUES ('test-user',50000,1)");
  db.exec("INSERT INTO provider_budget_limits VALUES ('cloudflare-workers-ai',50000,1)");
  db.exec("INSERT INTO provider_budget_limits VALUES ('__global__',50000,1)");
  const env={DB:{prepare(sql){
    return {
      bind(...params){return{first:async()=>db.prepare(sql).get(...params)};},
      first:async()=>db.prepare(sql).get()
    };
  }}};
  const audit=(opts={})=>inspectStage3CrossLedgerReconciliation(env,opts);
  const journal=(kind,requestId="r1",attemptId="a1",extra={})=>
    appendProviderUsageEvent(env,{
      attemptId,requestId,provider:tariff.provider,model:tariff.model,
      rateVersion:tariff.version,kind,...extra
    });
  const reserve=async(requestId="r1",{old=false,model=tariff.model}={})=>{
    const now=Date.now()-(old?7200_000:0);
    const a=await reserveProviderSpend(env,{
      id:"ai:"+requestId,provider:tariff.provider,model,
      maximumMicroUsd:8610n,nowMs:now
    });
    const b=await reserveCredits(env,{
      userId:"test-user",requestId,amountMicrocredits:8610n,
      now:Math.floor(now/1000)
    });
    assert.equal(a.ok,true);
    assert.equal(b.ok,true);
  };
  const settle=async(requestId="r1",usd=519n,credits=519n)=>{
    assert.equal((await settleProviderSpend(env,{
      id:"ai:"+requestId,actualMicroUsd:usd
    })).ok,true);
    assert.equal((await finalizeCredits(env,{
      userId:"test-user",requestId,settledMicrocredits:credits
    })).ok,true);
  };
  const paid=async(requestId="r1",attemptId="a1")=>
    runJournaledInferencePrototype({
      env,userId:"test-user",requestId,attemptId,tariff,
      maxInputTokens:24000,maxOutputTokens:700,
      providerBudget:providerSpendBudget(env),
      ledger:{reserve:reserveCredits,finalize:finalizeCredits},
      invokeModel:async()=>({
        result:"synthetic-only",usage:{prompt_tokens:1000,completion_tokens:100}
      })
    });
  const sum=(sql)=>db.prepare(sql).get();
  return {db,env,audit,journal,reserve,settle,paid,sum};
}
const usage={prompt_tokens:1000,completion_tokens:100};
async function measured(x,request="r1",attempt="a1",tokens=usage){
  assert.equal((await x.journal("dispatched",request,attempt)).ok,true);
  assert.equal((await x.journal("usage_measured",request,attempt,{
    usage:tokens,tariff
  })).ok,true);
}

test("empty all-three-schema read-only cross-ledger audit returns no false green invoices",async t=>{
  const x=setup(t);
  const before=x.sum("SELECT total_changes() AS n").n;
  const r=await x.audit();
  assert.equal(r.reviewRequired,false);
  assert.equal(r.dispatchedAttempts,0);
  assert.equal(r.measuredAttempts,0);
  assert.equal(r.providerInvoiceVerified,false);
  assert.equal(r.liveBillingApproved,false);
  assert.equal(x.sum("SELECT total_changes() AS n").n,before);
});

test("normal real SQL adapters and measured journal reconcile exactly",async t=>{
  const x=setup(t);
  const result=await x.paid();
  assert.equal(result.ok,true);
  assert.equal(result.providerCostMicroUsd,519n);
  const report=await x.audit();
  assert.equal(report.dispatchedAttempts,1);
  assert.equal(report.measuredAttempts,1);
  assert.equal(report.reviewRequired,false);
  assert.equal(report.settledCostMismatches,0);
  assert.equal(report.settledBudgetWithoutMeasuredUsage,0);
  assert.equal(JSON.stringify(report).includes("test-user"),false);
});

test("provider unknown outcome is flagged before stale timeout and remains unpaid",async t=>{
  const x=setup(t);
  await x.reserve();
  assert.equal((await x.journal("dispatched")).ok,true);
  assert.equal((await x.journal("outcome_unknown")).ok,true);
  const r=await x.audit();
  assert.equal(r.unknownUnmeasuredAttempts,1);
  assert.equal(r.reviewRequired,true);
  assert.equal(r.measuredAttempts,0);
});

test("old confirmed budget+wallet with no dispatch is a stale preflight hold",async t=>{
  const x=setup(t);
  await x.reserve("r1",{old:true});
  const r=await x.audit({staleAfterSeconds:3600});
  assert.equal(r.stalePreDispatchBudgetHolds,1);
  assert.equal(r.reviewRequired,true);
});

test("orphan dispatch without both actual financial reservations requires review",async t=>{
  const x=setup(t);
  assert.equal((await x.journal("dispatched")).ok,true);
  const r=await x.audit();
  assert.equal(r.orphanDispatches,1);
  assert.equal(r.reviewRequired,true);
});

test("provider or model mismatch between budget and journal is detected",async t=>{
  const x=setup(t);
  await x.reserve("r1",{model:"unapproved-model"});
  assert.equal((await x.journal("dispatched")).ok,true);
  const r=await x.audit();
  assert.equal(r.providerModelMismatches,1);
  assert.equal(r.reviewRequired,true);
});

test("positive provider settlement without authoritative usage is NOT clean",async t=>{
  const x=setup(t);
  await x.reserve();
  await x.settle();
  const r=await x.audit();
  assert.equal(r.settledBudgetWithoutMeasuredUsage,1);
  assert.equal(r.settledCreditWithoutMeasuredUsage,1);
  assert.equal(r.reviewRequired,true);
});

test("different provider settlement amount and immutable measured cost are reconciled",async t=>{
  const x=setup(t);
  await x.reserve();
  await measured(x);
  await x.settle("r1",518n,518n);
  const r=await x.audit();
  assert.equal(r.settledCostMismatches,1);
  assert.equal(r.reviewRequired,true);
  assert.equal(r.measuredBudgetStillHeld,0);
});

test("measured AI cost with unsettled global budget cannot be called clean",async t=>{
  const x=setup(t);
  await x.reserve();
  await measured(x);
  const r=await x.audit();
  assert.equal(r.measuredBudgetStillHeld,1);
  assert.equal(r.reviewRequired,true);
});

test("credit release AFTER a provider usage measurement is a high-risk exception",async t=>{
  const x=setup(t);
  await x.reserve();
  await measured(x);
  assert.equal((await finalizeCredits(x.env,{
    userId:"test-user",requestId:"r1"
  })).ok,true);
  const r=await x.audit();
  assert.equal(r.releasedCreditAfterMeasuredUsage,1);
  assert.equal(r.reviewRequired,true);
});

test("two paid provider attempts for one budget are detected, including aggregated overrun",async t=>{
  const x=setup(t);
  await x.reserve();
  // Both measured costs 5,127 micro-USD; the two attempts together exceed
  // the single 8,610 micro-USD reservation. A retry is never a free model call.
  const high={prompt_tokens:10000,completion_tokens:975};
  await measured(x,"r1","a1",high);
  await measured(x,"r1","a2",high);
  const r=await x.audit();
  assert.equal(r.multiAttemptRequests,1);
  assert.equal(r.measuredAboveReservedCeiling,1);
  assert.equal(r.reviewRequired,true);
});

test("recent pending dispatch is not yet stale, but becomes stale after threshold",async t=>{
  const x=setup(t);
  await x.reserve();
  assert.equal((await x.journal("dispatched")).ok,true);
  const fresh=await x.audit({staleAfterSeconds:3600});
  assert.equal(fresh.staleUnmeasuredAttempts,0);
  assert.equal(fresh.reviewRequired,false);
  const old=await x.audit({nowMs:Date.now()+7200_000,staleAfterSeconds:3600});
  assert.equal(old.staleUnmeasuredAttempts,1);
  assert.equal(old.reviewRequired,true);
});

test("missing schema, failed result and invalid clocks fail closed",async t=>{
  const x=setup(t);
  await assert.rejects(x.audit({staleAfterSeconds:0}),/stale window/);
  await assert.rejects(inspectStage3CrossLedgerReconciliation({}),/D1 binding/);
  const unavailable={DB:{prepare(){return{bind(){return{first:async()=>null}}};}}};
  await assert.rejects(inspectStage3CrossLedgerReconciliation(unavailable),/snapshot unavailable/);
  x.db.exec("DROP TABLE provider_usage_events");
  await assert.rejects(x.audit(),/no such table/);
});

test("post-dispatch zero-cost settlement is not silently classified as free",async t=>{
  const x=setup(t);
  await x.reserve();
  assert.equal((await x.journal("dispatched")).ok,true);
  assert.equal((await settleProviderSpend(x.env,{
    id:"ai:r1",actualMicroUsd:0n
  })).ok,true);
  assert.equal((await finalizeCredits(x.env,{
    userId:"test-user",requestId:"r1",settledMicrocredits:0n
  })).ok,true);
  const report=await x.audit();
  assert.equal(report.zeroSettledBudgetAfterDispatch,1);
  assert.equal(report.settledBudgetWithoutMeasuredUsage,0);
  assert.equal(report.reviewRequired,true);
});

test("credit release after provider dispatch without measured usage requires review",async t=>{
  const x=setup(t);
  await x.reserve();
  assert.equal((await x.journal("dispatched")).ok,true);
  assert.equal((await finalizeCredits(x.env,{
    userId:"test-user",requestId:"r1"
  })).ok,true);
  const report=await x.audit();
  assert.equal(report.releasedCreditAfterDispatch,1);
  assert.equal(report.releasedCreditAfterMeasuredUsage,0);
  assert.equal(report.reviewRequired,true);
});

test("measured paid usage cannot be settled with zero customer credits unnoticed",async t=>{
  const x=setup(t);
  await x.reserve();
  await measured(x);
  assert.equal((await settleProviderSpend(x.env,{
    id:"ai:r1",actualMicroUsd:519n
  })).ok,true);
  assert.equal((await finalizeCredits(x.env,{
    userId:"test-user",requestId:"r1",settledMicrocredits:0n
  })).ok,true);
  const report=await x.audit();
  assert.equal(report.zeroSettledCreditAfterMeasuredUsage,1);
  assert.equal(report.settledCostMismatches,0);
  assert.equal(report.reviewRequired,true);
});

test("customer credit settlement without any corresponding provider budget is an exception",async t=>{
  const x=setup(t);
  assert.equal((await reserveCredits(x.env,{
    userId:"test-user",requestId:"r1",amountMicrocredits:8610n
  })).ok,true);
  assert.equal((await finalizeCredits(x.env,{
    userId:"test-user",requestId:"r1",settledMicrocredits:519n
  })).ok,true);
  const report=await x.audit();
  assert.equal(report.settledCreditWithoutBudget,1);
  assert.equal(report.reviewRequired,true);
});

test("definitely unused pre-dispatch cancellation may settle zero without anomaly",async t=>{
  const x=setup(t);
  await x.reserve();
  assert.equal((await settleProviderSpend(x.env,{
    id:"ai:r1",actualMicroUsd:0n
  })).ok,true);
  assert.equal((await finalizeCredits(x.env,{
    userId:"test-user",requestId:"r1"
  })).ok,true);
  const report=await x.audit();
  assert.equal(report.zeroSettledBudgetAfterDispatch,0);
  assert.equal(report.releasedCreditAfterDispatch,0);
  assert.equal(report.reviewRequired,false);
});

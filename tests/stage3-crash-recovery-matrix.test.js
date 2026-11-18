// Stage 3 INACTIVE crash/restart recovery matrix using real, unapplied SQL.
// All data/provider usage is fictional. Diagnostics never mutate a wallet,
// automatically settle an uncertain invoice, or call any external service.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {reserveCredits,finalizeCredits} from "../src/credit-ledger.js";
import {reserveProviderSpend,settleProviderSpend} from "../src/provider-spend-budget.js";
import {appendProviderUsageEvent} from "../src/provider-usage-journal.js";
import {inspectStage3HoldTriage} from "../src/stage3-hold-triage.js";
import {inspectStage3CrossLedgerReconciliation} from "../src/stage3-cross-ledger-reconciliation.js";
import {inspectStage3RecoveryCase} from "../src/stage3-operator-case-triage.js";

const owner="crash-fixture-user";
const req="crash-fixture-req";
const attempt="crash-fixture-attempt";
const provider="cloudflare-workers-ai";
const model="@cf/synthetic";
const version="crash-fixture-v1";
const tariff={
  approved:true,provider,model,version,
  inputRateMicroUsdPerMillion:293000n,outputRateMicroUsdPerMillion:2253000n
};
const holdUsd=8610n;

function setup(t){
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  for(const file of ["0012_credit_ledger","0013_provider_spend_budget",
    "0014_provider_usage_journal","0018_provider_emergency_stop_draft"]){
    db.exec(readFileSync(new URL("../migrations/"+file+".sql",import.meta.url),"utf8"));
  }
  db.prepare("INSERT INTO credit_accounts VALUES (?,?,1)").run(owner,100000);
  for(const p of [provider,"__global__"])
    db.prepare("INSERT INTO provider_budget_limits VALUES (?,?,1)").run(p,100000);
  // OFF by default. Only this disposable fixture opts in to reservations.
  db.prepare("UPDATE provider_runtime_controls SET enabled=1,updated_at=1 WHERE control_name='paid_provider_dispatch'").run();
  const stmt=(sql,params=[])=>({
    bind(...args){return stmt(sql,args);},
    first:async()=>db.prepare(sql).get(...params)??null,
    run:async()=>({meta:{changes:db.prepare(sql).run(...params).changes}})
  });
  const env={DB:{prepare(sql){return stmt(sql);}}};
  const old=Date.now()-7200_000;
  const budget=()=>reserveProviderSpend(env,{
    id:"ai:"+req,provider,model,maximumMicroUsd:holdUsd,nowMs:old
  });
  const wallet=()=>reserveCredits(env,{
    userId:owner,requestId:req,amountMicrocredits:holdUsd,now:Math.floor(old/1000)
  });
  const event=kind=>appendProviderUsageEvent(env,{
    requestId:req,attemptId:attempt,provider,model,rateVersion:version,kind,
    nowMs:old+1000,...(kind==="usage_measured"?{
      usage:{prompt_tokens:1000,completion_tokens:100},tariff
    }:{})
  });
  const settleProvider=()=>settleProviderSpend(env,{
    id:"ai:"+req,actualMicroUsd:519n,nowMs:Date.now()
  });
  const settleWallet=()=>finalizeCredits(env,{
    userId:owner,requestId:req,settledMicrocredits:519n
  });
  const balance=()=>db.prepare("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id=?").get(owner).n;
  const before=()=>db.prepare("SELECT total_changes() AS n").get().n;
  const audit=async()=>{
    const change=before(),funds=balance();
    const cross=await inspectStage3CrossLedgerReconciliation(env,{
      nowMs:Date.now(),staleAfterSeconds:3600
    });
    const aggregate=await inspectStage3HoldTriage(env,{
      nowMs:Date.now(),staleAfterSeconds:3600
    });
    const single=await inspectStage3RecoveryCase(env,{
      requestId:req,expectedUserId:owner,expectedProvider:provider,
      expectedModel:model,expectedRateVersion:version
    });
    assert.equal(before(),change,"all recovery snapshots must be read-only");
    assert.equal(balance(),funds,"auditing must not change customer balance");
    assert.equal(single.operatorActionAuthorized,false);
    assert.equal(single.providerInvoiceVerified,false);
    assert.equal(cross.providerInvoiceVerified,false);
    assert.equal(aggregate.providerInvoiceVerified,false);
    for(const report of [cross,aggregate,single]){
      const serialized=JSON.stringify(report);
      for(const secret of [owner,req,attempt,provider,model])
        assert.equal(serialized.includes(secret),false,"operator report must not leak identifiers");
    }
    return {cross,aggregate,single};
  };
  const persisted=()=>db.prepare(
    "SELECT status AS state FROM provider_budget_reservations WHERE id=?"
  ).get("ai:"+req)?.state;
  const walletState=()=>db.prepare(
    "SELECT status AS state FROM credit_reservations WHERE request_id=?"
  ).get(req)?.state;
  return {db,env,budget,wallet,event,settleProvider,settleWallet,audit,balance,persisted,walletState,before};
}

test("crash between provider admission and wallet reserve is visible after restart",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.budget()).ok,false,"duplicate budget ID must not reserve again");
  const {cross,aggregate,single}=await x.audit();
  assert.equal(cross.staleBudgetWithoutWallet,1);
  assert.equal(cross.stalePreDispatchBudgetHolds,0);
  assert.equal(aggregate.orphanProviderBudgetHolds,1);
  assert.equal(single.reviewClass,"escalate");
  assert.ok(single.reasons.includes("wallet_record_missing"));
  assert.equal(x.persisted(),"reserved");
  assert.equal(x.balance(),100000);
  x.db.prepare("UPDATE provider_runtime_controls SET enabled=0,updated_at=2").run();
  assert.equal((await reserveProviderSpend(x.env,{
    id:"ai:other",provider,model,maximumMicroUsd:holdUsd
  })).ok,false,"global OFF must not create another budget");
  assert.equal(x.persisted(),"reserved","existing financial exposure cannot be erased by pause");
});
test("crash after both reservations but before dispatch is investigated without automatic refund",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.wallet()).ok,true);
  const {cross,aggregate,single}=await x.audit();
  assert.equal(cross.stalePreDispatchBudgetHolds,1);
  assert.equal(cross.staleBudgetWithoutWallet,0);
  assert.equal(aggregate.stalePreDispatchDualHolds,1);
  assert.equal(single.reviewClass,"candidate_verified_no_dispatch_review");
  assert.equal(single.operatorActionAuthorized,false);
  assert.equal(x.persisted(),"reserved");
  assert.equal(x.walletState(),"reserved");
  assert.equal(x.balance(),100000-Number(holdUsd));
});
test("crash after dispatch marker but before provider outcome requires invoice review",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.wallet()).ok,true);
  assert.equal((await x.event("dispatched")).ok,true);
  const {cross,aggregate,single}=await x.audit();
  assert.equal(cross.staleUnmeasuredAttempts,1);
  assert.equal(aggregate.staleDispatchesWithoutOutcome,1);
  assert.equal(single.reviewClass,"escalate");
  assert.ok(single.reasons.includes("unverified_provider_attempt"));
  assert.equal(x.persisted(),"reserved");
  assert.equal(x.walletState(),"reserved");
});
test("crash after measured tokens but before provider settlement leaves both holds",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.wallet()).ok,true);
  assert.equal((await x.event("dispatched")).ok,true);
  assert.equal((await x.event("usage_measured")).ok,true);
  const {cross,aggregate,single}=await x.audit();
  assert.equal(cross.measuredBudgetStillHeld,1);
  assert.equal(aggregate.measuredPendingProviderSettlement,1);
  assert.equal(single.reviewClass,"candidate_provider_then_wallet_review");
  assert.equal(x.persisted(),"reserved");
  assert.equal(x.walletState(),"reserved");
});
test("crash after provider settlement but before wallet finalization preserves held credits",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.wallet()).ok,true);
  assert.equal((await x.event("dispatched")).ok,true);
  assert.equal((await x.event("usage_measured")).ok,true);
  assert.equal((await x.settleProvider()).ok,true);
  const {aggregate,single}=await x.audit();
  assert.equal(aggregate.creditFinalizationPending,1);
  assert.equal(single.reviewClass,"candidate_wallet_finalization_review");
  assert.equal(x.persisted(),"settled");
  assert.equal(x.walletState(),"reserved");
  assert.equal(x.balance(),100000-Number(holdUsd));
});
test("unsafe wallet-first settlement is escalated, never represented as complete",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.wallet()).ok,true);
  assert.equal((await x.event("dispatched")).ok,true);
  assert.equal((await x.event("usage_measured")).ok,true);
  assert.equal((await x.settleWallet()).ok,true);
  const {aggregate,single}=await x.audit();
  assert.equal(aggregate.providerFinalizationPending,1);
  assert.equal(single.reviewClass,"escalate");
  assert.ok(single.reasons.includes("customer_credit_settled_without_provider"));
  assert.equal(x.persisted(),"reserved");
  assert.equal(x.walletState(),"settled");
});

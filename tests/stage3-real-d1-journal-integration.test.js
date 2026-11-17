// Stage 3 INACTIVE integration proof: actual Stage 2 D1 adapter functions
// and all three SQL migrations on disposable in-memory SQLite. Never live AI,
// real funds, remote D1, production migration or authentic provider invoice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { reserveCredits, finalizeCredits } from "../src/credit-ledger.js";
import { providerSpendBudget } from "../src/provider-spend-budget.js";
import { inspectDraftBillingReconciliation } from "../src/billing-reconciliation.js";
import { appendProviderUsageEvent, inspectProviderUsageJournal } from "../src/provider-usage-journal.js";
import { runJournaledInferencePrototype } from "../src/stage3-journaled-inference.js";

const migrations=[
  "../migrations/0012_credit_ledger.sql",
  "../migrations/0013_provider_spend_budget.sql",
  "../migrations/0014_provider_usage_journal.sql"
].map(path=>readFileSync(new URL(path,import.meta.url),"utf8"));
const tariff=Object.freeze({
  approved:true,version:"synthetic-only",provider:"cloudflare-workers-ai",
  model:"@cf/synthetic-integration",inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n,
  creditNumerator:1n,creditDenominator:1n,
  maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
});
const limits={provider:50000,global:60000};
function fixture(t,{balance=50000,providerCap=limits.provider,globalCap=limits.global}={}){
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  for(const migration of migrations) sqlite.exec(migration);
  sqlite.prepare(
    "INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES (?,?,1)"
  ).run("synthetic-user",balance);
  for(const [provider,cap] of [[tariff.provider,providerCap],["__global__",globalCap]]) {
    sqlite.prepare(
      "INSERT INTO provider_budget_limits(provider,daily_cap_micro_usd,updated_at) VALUES (?,?,1)"
    ).run(provider,cap);
  }
  const statement=(sql,params=[])=>({
    sql,params,
    bind(...args){return statement(sql,args);},
    first:async()=>sqlite.prepare(sql).get(...params),
    run:async()=>({meta:{changes:sqlite.prepare(sql).run(...params).changes}})
  });
  const DB={
    prepare(sql){return statement(sql);},
    async batch(statements){
      sqlite.exec("BEGIN");
      try {
        const results=statements.map(st=>({
          success:true,results:sqlite.prepare(st.sql).all(...st.params)
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch(error){
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  const env={DB};
  const actualBudget=providerSpendBudget(env);
  const actualLedger={reserve:reserveCredits,finalize:finalizeCredits};
  let invoked=0;
  const defaultModel=async()=>{invoked++;
    return {response:"synthetic",usage:{prompt_tokens:1000,completion_tokens:100}};
  };
  const run=(opts={})=>runJournaledInferencePrototype({
    env,userId:"synthetic-user",requestId:"req-1",attemptId:"attempt-1",
    tariff,maxInputTokens:24000,maxOutputTokens:700,
    providerBudget:actualBudget,ledger:actualLedger,
    journal:appendProviderUsageEvent,invokeModel:defaultModel,...opts
  });
  const scalar=(sql,...args)=>sqlite.prepare(sql).get(...args);
  return {sqlite,env,run,scalar,actualBudget,actualLedger,
    invoked:()=>invoked,
    balance:()=>scalar("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id='synthetic-user'").n,
    budget:()=>scalar("SELECT status,reserved_micro_usd,actual_micro_usd FROM provider_budget_reservations WHERE id='ai:req-1'"),
    reservation:()=>scalar("SELECT status,reserved_microcredits,settled_microcredits FROM credit_reservations WHERE request_id='req-1'"),
    journal:()=>sqlite.prepare("SELECT event_kind,provider_cost_micro_usd FROM provider_usage_events ORDER BY rowid").all(),
    money:()=>sqlite.prepare("SELECT delta_microcredits FROM credit_ledger ORDER BY rowid").all().map(r=>r.delta_microcredits),
    audit:()=>inspectDraftBillingReconciliation(env),
    providerAudit:()=>inspectProviderUsageJournal(env)
  };
}
test("real D1 SQL modules and append-only journal settle one exact synthetic charge",async t=>{
  const x=fixture(t);
  const output=await x.run();
  assert.equal(output.ok,true);
  assert.equal(output.providerCostMicroUsd,519n);
  assert.equal(output.customerDebitMicrocredits,519n);
  assert.equal(x.invoked(),1);
  assert.equal(x.balance(),49481);
  assert.deepEqual(x.money(),[-8610,8091]);
  assert.equal(x.reservation().status,"settled");
  assert.equal(x.reservation().settled_microcredits,519);
  assert.equal(x.budget().status,"settled");
  assert.equal(x.budget().actual_micro_usd,519);
  assert.deepEqual(x.journal().map(e=>e.event_kind),["dispatched","usage_measured"]);
  assert.equal(x.journal()[1].provider_cost_micro_usd,519);
  const report=await x.audit();
  assert.equal(report.reviewRequired,false);
  assert.equal(report.bothSettled,1);
  assert.equal(report.mismatchedWalletJournals,0);
  assert.equal(report.mismatchedDailyCounters,0);
  assert.equal(report.providerInvoiceVerified,false);
  const provider=await x.providerAudit();
  assert.equal(provider.unresolvedAttempts,0);
  assert.equal(provider.measuredCostMicroUsd,519);
  assert.equal(provider.providerInvoiceVerified,false);
});
test("real provider budget prevents replay even with a distinct journal attempt",async t=>{
  const x=fixture(t);
  assert.equal((await x.run()).ok,true);
  const second=await x.run({attemptId:"attempt-2"});
  assert.equal(second.ok,false);
  assert.equal(second.reason,"provider_budget_reservation_rejected");
  assert.equal(second.modelInvoked,false);
  assert.equal(x.invoked(),1);
  assert.equal(x.balance(),49481);
  assert.equal(x.journal().length,2);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM credit_reservations").n,1);
});
test("missing global operator cap denies provider call before credit reservation",async t=>{
  const x=fixture(t);
  x.sqlite.prepare("DELETE FROM provider_budget_limits WHERE provider='__global__'").run();
  const result=await x.run();
  assert.equal(result.reason,"provider_budget_reservation_rejected");
  assert.equal(x.invoked(),0);
  assert.equal(x.balance(),50000);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM provider_budget_reservations").n,0);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM credit_reservations").n,0);
  assert.equal(x.journal().length,0);
});
test("insufficient real credit rolls back wallet and releases unused provider budget",async t=>{
  const x=fixture(t,{balance:100});
  const result=await x.run();
  assert.equal(result.reason,"credit_reservation_rejected");
  assert.equal(x.invoked(),0);
  assert.equal(x.balance(),100);
  assert.equal(x.budget().status,"settled");
  assert.equal(x.budget().actual_micro_usd,0);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM credit_reservations").n,0);
  assert.equal(x.journal().length,0);
});
test("missing journal table never dispatches the synthetic provider and holds both reserves",async t=>{
  const x=fixture(t);
  x.sqlite.exec("DROP TABLE provider_usage_events");
  const result=await x.run();
  assert.equal(result.reason,"journal_dispatch_unconfirmed_reservations_held");
  assert.equal(result.modelInvoked,false);
  assert.equal(x.invoked(),0);
  assert.equal(x.balance(),41390);
  assert.equal(x.reservation().status,"reserved");
  assert.equal(x.budget().status,"reserved");
  const report=await inspectDraftBillingReconciliation(x.env,{
    nowMs:Date.now()+3600000,staleAfterSeconds:60
  });
  assert.equal(report.staleDualHolds,1);
});
test("unknown AI outcome preserves both actual financial reservations and audit evidence",async t=>{
  const x=fixture(t);
  const result=await x.run({
    invokeModel:async()=>{throw Error("synthetic upstream timeout");}
  });
  assert.equal(result.reason,"provider_outcome_unknown_reservations_held");
  assert.equal(result.modelInvoked,true);
  assert.equal(x.balance(),41390);
  assert.equal(x.budget().status,"reserved");
  assert.equal(x.reservation().status,"reserved");
  assert.deepEqual(x.journal().map(e=>e.event_kind),["dispatched","outcome_unknown"]);
  const audit=await x.providerAudit();
  assert.equal(audit.unresolvedAttempts,1);
  assert.equal(audit.unknownEvents,1);
  assert.equal(audit.reviewRequired,true);
  const billing=await inspectDraftBillingReconciliation(x.env,{
    nowMs:Date.now()+3600000,staleAfterSeconds:60
  });
  assert.equal(billing.staleDualHolds,1);
});
test("contradictory measured token aliases refuse both real settlements",async t=>{
  const x=fixture(t);
  const result=await x.run({invokeModel:async()=>({
    usage:{prompt_tokens:1000,completion_tokens:100,input_tokens:900,output_tokens:100}
  })});
  assert.equal(result.reason,"metering_unverified_reservations_held");
  assert.equal(x.balance(),41390);
  assert.equal(x.budget().status,"reserved");
  assert.equal(x.reservation().status,"reserved");
  assert.deepEqual(x.journal().map(e=>e.event_kind),["dispatched","usage_unverified"]);
  assert.equal((await x.providerAudit()).unresolvedAttempts,1);
});
test("actual provider settle failure never settles customer wallet nor releases paid answer",async t=>{
  const x=fixture(t);
  const providerBudget={
    reserve:x.actualBudget.reserve,
    settle:async()=>({ok:false})
  };
  const result=await x.run({providerBudget});
  assert.equal(result.reason,"provider_budget_settlement_failed_reservations_held");
  assert.equal(x.balance(),41390);
  assert.equal(x.budget().status,"reserved");
  assert.equal(x.reservation().status,"reserved");
  assert.equal(x.journal()[1].provider_cost_micro_usd,519);
});
test("actual budget settled but wallet finalization failure is flagged for operator",async t=>{
  const x=fixture(t);
  const ledger={reserve:x.actualLedger.reserve,finalize:async()=>({ok:false})};
  const result=await x.run({ledger});
  assert.equal(result.reason,"credit_settlement_failed_reservation_held");
  assert.equal(x.balance(),41390);
  assert.equal(x.budget().status,"settled");
  assert.equal(x.budget().actual_micro_usd,519);
  assert.equal(x.reservation().status,"reserved");
  const report=await x.audit();
  assert.equal(report.creditFinalizationPending,1);
  assert.equal(report.reviewRequired,true);
  assert.equal(x.journal()[1].provider_cost_micro_usd,519);
});
test("actual remote-style D1 ledger constraints prevent duplicate refund and identity mutation",async t=>{
  const x=fixture(t);
  assert.equal((await x.run()).ok,true);
  assert.equal((await x.actualLedger.finalize(x.env,{
    userId:"synthetic-user",requestId:"req-1",settledMicrocredits:519n
  })).ok,false);
  assert.equal(x.balance(),49481);
  assert.deepEqual(x.money(),[-8610,8091]);
  assert.throws(()=>x.sqlite.prepare(
    "UPDATE credit_reservations SET user_id='other' WHERE request_id='req-1'").run(),
    /reservation_identity_immutable|invalid_reservation_transition/);
  assert.throws(()=>x.sqlite.prepare(
    "DELETE FROM provider_budget_reservations").run(),/forbidden/);
});
test("simulated concurrent unknown outcomes obey real SQLite global budget cap",async t=>{
  const x=fixture(t,{balance:50000,providerCap:17220,globalCap:17220});
  const outcomes=await Promise.all(Array.from({length:8},(_,i)=>x.run({
    requestId:"req-concurrent-"+i,attemptId:"attempt-concurrent-"+i,
    invokeModel:async()=>{throw Error("synthetic unknown provider outcome");}
  })));
  assert.equal(outcomes.filter(o=>o.reason==="provider_outcome_unknown_reservations_held").length,2);
  assert.equal(outcomes.filter(o=>o.reason==="provider_budget_reservation_rejected").length,6);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM provider_budget_reservations").n,2);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM credit_reservations").n,2);
  assert.equal(x.scalar("SELECT COUNT(*) AS n FROM provider_usage_events WHERE event_kind='dispatched'").n,2);
  assert.equal(x.balance(),50000-17220);
  assert.equal((await x.providerAudit()).unresolvedAttempts,2);
  const report=await inspectDraftBillingReconciliation(x.env,{
    nowMs:Date.now()+3600000,staleAfterSeconds:60
  });
  assert.equal(report.staleDualHolds,2);
});

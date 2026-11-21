import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {inspectDraftBillingReconciliation} from "../src/billing-reconciliation.js";
import {reserveCredits, finalizeCredits} from "../src/credit-ledger.js";
import {reserveProviderSpend,settleProviderSpend,providerSpendBudget} from "../src/provider-spend-budget.js";
import {runReservedBillableInference} from "../src/billable-inference-gate.js";

const creditSchema=readFileSync(new URL("../migrations/0012_credit_ledger.sql",import.meta.url),"utf8");
const budgetSchema=readFileSync(new URL("../migrations/0013_provider_spend_budget.sql",import.meta.url),"utf8");
const tariff={
 approved:true,version:"test",provider:"cloudflare-workers-ai",model:"synthetic",
 inputRateMicroUsdPerMillion:293000n,outputRateMicroUsdPerMillion:2253000n,
 creditNumerator:1n,creditDenominator:1n,
 maxCallMicroUsd:10000n,maxCallMicrocredits:10000n
};
function setup(t) {
 const sqlite=new DatabaseSync(":memory:");
 t.after(()=>sqlite.close());
 sqlite.exec(creditSchema);
 sqlite.exec(budgetSchema);
 sqlite.exec("INSERT INTO credit_accounts VALUES ('user',50000,1)");
 sqlite.exec("INSERT INTO provider_budget_limits VALUES ('cloudflare-workers-ai',1000000,1)");
 sqlite.exec("INSERT INTO provider_budget_limits VALUES ('__global__',1000000,1)");
 const DB={
   prepare(sql) {
     const statement=sqlite.prepare(sql);
     return {
       sql,params:[],
       bind(...values) {
         return {sql,params:values,
           first:async()=>statement.get(...values),
           run:async()=>({meta:{changes:statement.run(...values).changes}})};
       },
       first:async()=>statement.get()
     };
   },
   async batch(statements) {
     sqlite.exec("BEGIN");
     try {
       const result=statements.map(statement=>({
         success:true,
         results:sqlite.prepare(statement.sql).all(...statement.params)
       }));
       sqlite.exec("COMMIT");
       return result;
     } catch(error) {
       sqlite.exec("ROLLBACK");
       throw error;
     }
   }
 };
 const env={DB};
 const report=(nowMs=Date.now(),staleAfterSeconds=3600)=>
   inspectDraftBillingReconciliation(env,{nowMs,staleAfterSeconds});
 const reserveBudget=(requestId,nowMs=Date.now())=>reserveProviderSpend(env,{
   id:"ai:"+requestId,provider:"cloudflare-workers-ai",model:"synthetic",
   maximumMicroUsd:8610n,nowMs
 });
 const reserveWallet=(requestId,now)=>reserveCredits(env,{
   userId:"user",requestId,amountMicrocredits:8610n,...(now?{now}: {})
 });
 const finalizeBudget=(requestId,actualMicroUsd=519n)=>settleProviderSpend(env,{
   id:"ai:"+requestId,actualMicroUsd
 });
 const finalizeWallet=(requestId,settledMicrocredits=519n)=>finalizeCredits(env,{
   userId:"user",requestId,settledMicrocredits
 });
 return {sqlite,env,report,reserveBudget,reserveWallet,finalizeBudget,finalizeWallet};
}
test("empty read-only report has no PII and makes no database writes",async t=>{
 const x=setup(t);
 const before=x.sqlite.prepare("SELECT total_changes() AS count").get().count;
 const report=await x.report();
 assert.equal(report.budgetOrders,0);
 assert.equal(report.bothSettled,0);
 assert.equal(report.reviewRequired,false);
 assert.equal(report.providerInvoiceVerified,false);
 assert.equal(report.scope,"prototype_local_ledger_only");
 assert.equal(JSON.stringify(report).includes("user"),false);
 assert.equal(x.sqlite.prepare("SELECT total_changes() AS count").get().count,before);
});
test("complete atomic budget+credit settlement has no reconciliation exceptions",async t=>{
 const x=setup(t);
 const result=await runReservedBillableInference({
   env:x.env,userId:"user",requestId:"completed",tariff,
   maxInputTokens:24000,maxOutputTokens:700,
   providerBudget:providerSpendBudget(x.env),
   invokeModel:async()=>({response:"synthetic",usage:{prompt_tokens:1000,completion_tokens:100}})
 });
 assert.equal(result.ok,true);
 const report=await x.report();
 assert.equal(report.budgetOrders,1);
 assert.equal(report.bothSettled,1);
 assert.equal(report.mismatchedDailyCounters,0);
 assert.equal(report.creditFinalizationPending,0);
 assert.equal(report.reviewRequired,false);
 assert.equal(report.mismatchedWalletJournals,0);
 assert.equal(report.dailyCountersOverCurrentCap,0);
});
test("detect budget settled while customer credit is still reserved",async t=>{
 const x=setup(t);
 await x.reserveBudget("credit-pending");
 await x.reserveWallet("credit-pending");
 await x.finalizeBudget("credit-pending");
 const report=await x.report();
 assert.equal(report.creditFinalizationPending,1);
 assert.equal(report.reviewRequired,true);
 assert.equal(report.mismatchedDailyCounters,0);
});
test("detect stale dual reservations without releasing uncertain provider costs",async t=>{
 const x=setup(t);
 const old=Date.now()-7200_000;
 await x.reserveBudget("stale-dual",old);
 await x.reserveWallet("stale-dual",Math.floor(old/1000));
 const before=x.sqlite.prepare("SELECT total_changes() AS n").get().n;
 const report=await x.report(Date.now(),3600);
 assert.equal(report.staleBudgetHolds,1);
 assert.equal(report.staleDualHolds,1);
 assert.equal(report.reviewRequired,true);
 assert.equal(x.sqlite.prepare("SELECT total_changes() AS n").get().n,before);
});
test("detect unmatched budget or wallet reservations for operator review",async t=>{
 const x=setup(t);
 await x.reserveBudget("budget-only");
 await x.reserveWallet("wallet-only");
 const report=await x.report();
 assert.equal(report.unmatchedBudgetHolds,1);
 assert.equal(report.unpairedReservedCredit,1);
 assert.equal(report.reviewRequired,true);
});
test("provider settlement still open after wallet settlement is an exception",async t=>{
 const x=setup(t);
 await x.reserveBudget("budget-open");
 await x.reserveWallet("budget-open");
 await x.finalizeWallet("budget-open");
 const report=await x.report();
 assert.equal(report.providerFinalizationPending,1);
 assert.equal(report.reviewRequired,true);
});
test("detect nonzero provider cost with missing/deleted customer debit",async t=>{
 const x=setup(t);
 await x.reserveBudget("no-wallet");
 await x.finalizeBudget("no-wallet");
 const report=await x.report();
 assert.equal(report.paidProviderWithoutCreditDebit,1);
 assert.equal(report.reviewRequired,true);
});
test("reconcile totals detect tampered counter aggregates and missing cap",async t=>{
 const x=setup(t);
 await x.reserveBudget("one");
 x.sqlite.exec("UPDATE provider_budget_daily SET spent_micro_usd=99 WHERE provider='__global__'");
 x.sqlite.exec("DELETE FROM provider_budget_limits WHERE provider='cloudflare-workers-ai'");
 const report=await x.report();
 assert.equal(report.mismatchedDailyCounters,1);
 assert.equal(report.counterRowsWithoutCurrentCap,1);
 assert.equal(report.reviewRequired,true);
});
test("missing daily counter for a reservation is reported",async t=>{
 const x=setup(t);
 await x.reserveBudget("one");
 x.sqlite.exec("DELETE FROM provider_budget_daily WHERE provider='cloudflare-workers-ai'");
 const report=await x.report();
 assert.equal(report.reservationsWithoutDailyCounters,1);
 assert.equal(report.reviewRequired,true);
});
test("missing schema fails closed instead of claiming clean financial status",async t=>{
 const db=new DatabaseSync(":memory:");
 t.after(()=>db.close());
 const env={DB:{
   prepare(sql){return {sql,params:[],bind(...params){return{sql,params}}};},
   async batch(statements){return statements.map(s=>({results:db.prepare(s.sql).all(...s.params)}));}
 }};
 await assert.rejects(inspectDraftBillingReconciliation(env),/no such table/);
 await assert.rejects(inspectDraftBillingReconciliation({DB:null}),/D1 binding required/);
 await assert.rejects(inspectDraftBillingReconciliation(env,{staleAfterSeconds:0}),/minimum 60-second/);
});

test("detect credit ledger debit corruption even if both financial states are settled",async t=>{
 const x=setup(t);
 await x.reserveBudget("tampered");
 await x.reserveWallet("tampered");
 await x.finalizeBudget("tampered");
 await x.finalizeWallet("tampered");
 assert.equal((await x.report()).mismatchedWalletJournals,0);
 x.sqlite.exec("UPDATE credit_ledger SET delta_microcredits=-1 WHERE reason='reserve' AND reference_id='tampered'");
 const report=await x.report();
 assert.equal(report.bothSettled,1);
 assert.equal(report.mismatchedWalletJournals,1);
 assert.equal(report.reviewRequired,true);
});
test("detect missing credit reservation journal and impossible refund",async t=>{
 const x=setup(t);
 await x.reserveWallet("lost-entry");
 x.sqlite.exec("DELETE FROM credit_ledger WHERE reason='reserve' AND reference_id='lost-entry'");
 let report=await x.report();
 assert.equal(report.mismatchedWalletJournals,1);
 assert.equal(report.reviewRequired,true);
});
test("reject current budget overrun even when journal aggregates agree",async t=>{
 const x=setup(t);
 await x.reserveBudget("over-new-cap");
 x.sqlite.exec("UPDATE provider_budget_limits SET daily_cap_micro_usd=100 WHERE provider='__global__'");
 const report=await x.report();
 assert.equal(report.mismatchedDailyCounters,0);
 assert.equal(report.dailyCountersOverCurrentCap,1);
 assert.equal(report.reviewRequired,true);
});
test("read-only audit fails on incomplete transaction batch rather than reporting clean",async t=>{
 const x=setup(t);
 const broken={DB:{prepare:x.env.DB.prepare,batch:async()=>[{success:true,results:[]}]}};
 await assert.rejects(inspectDraftBillingReconciliation(broken),/snapshot unavailable/);
 const failed={DB:{prepare:x.env.DB.prepare,batch:async()=>Array.from({length:7},()=>({success:false,results:[{}]}))}};
 await assert.rejects(inspectDraftBillingReconciliation(failed),/result incomplete/);
});

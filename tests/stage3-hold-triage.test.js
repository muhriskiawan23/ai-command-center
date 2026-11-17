// All tests are local in-memory SQLite with the ACTUAL UNAPPLIED Stage 2/3
// migrations and adapters. No Cloudflare, AI model, Midtrans or live customer.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {reserveCredits,finalizeCredits} from "../src/credit-ledger.js";
import {reserveProviderSpend,settleProviderSpend} from "../src/provider-spend-budget.js";
import {appendProviderUsageEvent} from "../src/provider-usage-journal.js";
import {inspectStage3HoldTriage} from "../src/stage3-hold-triage.js";

const baseMs=1_735_000_000_000;
const tariff=Object.freeze({
  approved:true,version:"synthetic-v1",provider:"cloudflare-workers-ai",
  model:"@cf/synthetic",inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n
});
const migrationPaths=[
  "../migrations/0012_credit_ledger.sql",
  "../migrations/0013_provider_spend_budget.sql",
  "../migrations/0014_provider_usage_journal.sql"
];
function setup(t) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  for (const path of migrationPaths)
    sqlite.exec(readFileSync(new URL(path,import.meta.url),"utf8"));
  sqlite.prepare("INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES (?,?,1)")
    .run("synthetic-user",100000);
  for(const provider of [tariff.provider,"__global__"])
    sqlite.prepare("INSERT INTO provider_budget_limits(provider,daily_cap_micro_usd,updated_at) VALUES (?,?,1)")
      .run(provider,500000);
  const DB={prepare(sql){return{
    bind(...params){return {
      first:async()=>sqlite.prepare(sql).get(...params),
      run:async()=>({meta:{changes:sqlite.prepare(sql).run(...params).changes}})
    };},
    first:async()=>sqlite.prepare(sql).get()
  };}};
  const env={DB};
  async function budget(requestId="req1"){
    return reserveProviderSpend(env,{
      id:"ai:"+requestId,provider:tariff.provider,model:tariff.model,
      maximumMicroUsd:9000n,nowMs:baseMs
    });
  }
  async function wallet(requestId="req1"){
    return reserveCredits(env,{
      userId:"synthetic-user",requestId,amountMicrocredits:9000n,
      now:Math.floor(baseMs/1000)
    });
  }
  async function event(kind,requestId="req1",attemptId="attempt1"){
    return appendProviderUsageEvent(env,{
      attemptId,requestId,kind,provider:tariff.provider,
      model:tariff.model,rateVersion:tariff.version,
      ...(kind==="usage_measured" ? {
        usage:{prompt_tokens:1000,completion_tokens:100},tariff
      } : {}),
      nowMs:baseMs+1000
    });
  }
  async function report(){
    return inspectStage3HoldTriage(env,{nowMs:baseMs+7200000,staleAfterSeconds:60});
  }
  return {sqlite,env,budget,wallet,event,report};
}
test("clean measured full settlement shows no hold triage, not invoice verification",async t=>{
  const x=setup(t);
  assert.equal((await x.budget()).ok,true);
  assert.equal((await x.wallet()).ok,true);
  assert.equal((await x.event("dispatched")).ok,true);
  assert.equal((await x.event("usage_measured")).ok,true);
  assert.equal((await settleProviderSpend(x.env,{id:"ai:req1",actualMicroUsd:519n})).ok,true);
  assert.equal((await finalizeCredits(x.env,{userId:"synthetic-user",requestId:"req1",settledMicrocredits:519n})).ok,true);
  const report=await x.report();
  assert.equal(report.budgetReservations,1);
  assert.equal(report.reviewRequired,false);
  assert.equal(report.providerInvoiceVerified,false);
  assert.equal(report.settledMeasuredCostMismatch,0);
  assert.equal(report.settledWithoutMeasuredUsage,0);
  assert.equal(JSON.stringify(report).includes("synthetic-user"),false);
  assert.equal(JSON.stringify(report).includes("req1"),false);
});
test("unknown outcome has two holds and requires operator review",async t=>{
  const x=setup(t);
  await x.budget();await x.wallet();
  assert.equal((await x.event("dispatched")).ok,true);
  assert.equal((await x.event("outcome_unknown")).ok,true);
  const report=await x.report();
  assert.equal(report.unknownProviderHolds,1);
  assert.equal(report.staleBudgetHolds,1);
  assert.equal(report.stalePreDispatchDualHolds,0);
  assert.equal(report.staleDispatchesWithoutOutcome,0);
  assert.equal(report.reviewRequired,true);
});
test("stale dispatch without an outcome remains visible after another attempt reports usage", async t => {
  const x = setup(t);
  assert.equal((await x.budget()).ok, true);
  assert.equal((await x.wallet()).ok, true);
  assert.equal((await x.event("dispatched")).ok, true);
  const fresh = await inspectStage3HoldTriage(x.env, { nowMs: baseMs + 30000, staleAfterSeconds: 60 });
  assert.equal(fresh.staleDispatchesWithoutOutcome, 0);

  assert.equal((await x.event("dispatched", "req1", "attempt2")).ok, true);
  assert.equal((await x.event("usage_measured", "req1", "attempt2")).ok, true);
  const report = await x.report();
  assert.equal(report.staleDispatchesWithoutOutcome, 1);
  assert.equal(report.measuredPendingProviderSettlement, 1);
  assert.equal(report.reviewRequired, true);
  assert.equal(x.sqlite.prepare("SELECT status FROM provider_budget_reservations").get().status, "reserved");
  assert.equal(x.sqlite.prepare("SELECT status FROM credit_reservations").get().status, "reserved");
});
test("pre-dispatch stale holds are NOT silently released",async t=>{
  const x=setup(t);await x.budget();await x.wallet();
  const balanceBefore=x.sqlite.prepare("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id='synthetic-user'").get().n;
  const r=await x.report();
  assert.equal(r.stalePreDispatchDualHolds,1);
  assert.equal(r.reviewRequired,true);
  assert.equal(x.sqlite.prepare("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id='synthetic-user'").get().n,balanceBefore);
  assert.equal(x.sqlite.prepare("SELECT status FROM credit_reservations WHERE request_id='req1'").get().status,"reserved");
});
test("measured journal followed by failed settlement is identified",async t=>{
  const x=setup(t);await x.budget();await x.wallet();
  await x.event("dispatched");await x.event("usage_measured");
  const a=await x.report();
  assert.equal(a.measuredPendingProviderSettlement,1);
  await settleProviderSpend(x.env,{id:"ai:req1",actualMicroUsd:519n});
  const b=await x.report();
  assert.equal(b.measuredPendingProviderSettlement,0);
  assert.equal(b.creditFinalizationPending,1);
  assert.equal(b.reviewRequired,true);
});
test("provider settled without journal or with inconsistent amount is flagged",async t=>{
  const x=setup(t);await x.budget();await x.wallet();
  await settleProviderSpend(x.env,{id:"ai:req1",actualMicroUsd:519n});
  assert.equal((await x.report()).settledWithoutMeasuredUsage,1);
  const y=setup(t);await y.budget();await y.wallet();
  await y.event("dispatched");await y.event("usage_measured");
  await settleProviderSpend(y.env,{id:"ai:req1",actualMicroUsd:520n});
  assert.equal((await y.report()).settledMeasuredCostMismatch,1);
  const z=setup(t);await z.budget();await z.wallet();
  await z.event("dispatched");await z.event("usage_measured");
  assert.equal((await settleProviderSpend(z.env,{id:"ai:req1",actualMicroUsd:0n})).ok,true);
  assert.equal((await z.report()).settledMeasuredCostMismatch,1);
  const w=setup(t);await w.budget();await w.wallet();
  assert.equal((await settleProviderSpend(w.env,{id:"ai:req1",actualMicroUsd:0n})).ok,true);
  assert.equal((await finalizeCredits(w.env,{userId:"synthetic-user",requestId:"req1",settledMicrocredits:1n})).ok,true);
  assert.equal((await w.report()).walletSettledWithoutMeasuredUsage,1);
});
test("orphan provider budget, wallet and dispatch are detected independently",async t=>{
  const x=setup(t);await x.budget();
  assert.equal((await x.report()).orphanProviderBudgetHolds,1);
  const y=setup(t);await y.wallet();
  assert.equal((await y.report()).orphanWalletHolds,1);
  const z=setup(t);
  // A synthetic orphan can occur after a D1 restore/schema inconsistency;
  // the dispatch record is immutable and is not touched by triage.
  await z.event("dispatched");
  assert.equal((await z.report()).orphanJournalDispatches,1);
});
test("unverified token usage and invalid or missing schema fail closed",async t=>{
  const x=setup(t);await x.budget();await x.wallet();await x.event("dispatched");
  await x.event("usage_unverified");
  assert.equal((await x.report()).unverifiedUsageHolds,1);
  await assert.rejects(
    inspectStage3HoldTriage(x.env,{nowMs:-1}),
    /timestamp/
  );
  await assert.rejects(inspectStage3HoldTriage({DB:{prepare(){throw Error("offline")}}}),
    /offline/);
  assert.throws(()=>x.sqlite.prepare("DELETE FROM provider_usage_events").run(),/append_only/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { appendProviderUsageEvent, inspectProviderUsageJournal } from "../src/provider-usage-journal.js";
import {
  runJournaledInferencePrototype, quoteJournaledInference
} from "../src/stage3-journaled-inference.js";

const schema=readFileSync(
  new URL("../migrations/0014_provider_usage_journal.sql",import.meta.url),"utf8");
const tariff=Object.freeze({
  approved:true,version:"synthetic-v1",provider:"workers-ai",model:"@cf/test",
  inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n,
  creditNumerator:1n,creditDenominator:1n,
  maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
});
const fixed={
  userId:"test-member",requestId:"req-one",attemptId:"attempt-one",
  tariff,maxInputTokens:24000,maxOutputTokens:700
};
function setup(t,config={}){
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  sqlite.exec(schema);
  const env={STAGE3_SYNTHETIC_ONLY:"true",DB:{prepare(sql){return {
    bind(...params){return{first:async()=>sqlite.prepare(sql).get(...params)};},
    first:async()=>sqlite.prepare(sql).get()
  };}}};
  const trace=[],budgetIds=new Set(),walletIds=new Set();
  let balance=15000n,paid=0n,invoked=0;
  const providerBudget={
    async reserve({id}) {
      trace.push("budget:reserve");
      if(config.rejectBudget || budgetIds.has(id))return {ok:false};
      budgetIds.add(id);return {ok:true};
    },
    async settle({id,actualMicroUsd}) {
      trace.push("budget:settle");
      if(config.failBudgetSettle)return {ok:false};
      assert.equal(budgetIds.has(id),true);
      paid+=actualMicroUsd;return {ok:true};
    }
  };
  const ledger={
    async reserve(_env,{requestId,amountMicrocredits}) {
      trace.push("wallet:reserve");
      if(config.rejectWallet || walletIds.has(requestId) || balance<amountMicrocredits)
        return {ok:false};
      walletIds.add(requestId);balance-=amountMicrocredits;
      return {ok:true};
    },
    async finalize(_env,{requestId,settledMicrocredits}){
      trace.push("wallet:finalize");
      if(config.failWalletSettle)return{ok:false};
      assert.equal(walletIds.has(requestId),true);
      const reserved=quoteJournaledInference(fixed).reservedMicrocredits;
      balance+=reserved-settledMicrocredits;
      return {ok:true};
    }
  };
  const journal=async(env,entry)=>{
    trace.push("journal:"+entry.kind);
    if(config.failDispatch && entry.kind==="dispatched")return{ok:false};
    if(config.failMeasured && entry.kind==="usage_measured")return{ok:false};
    return appendProviderUsageEvent(env,entry);
  };
  const invokeModel=async()=>{
    trace.push("model:invoke");
    invoked++;
    if(config.providerThrows)throw Error("simulated provider timeout");
    return config.response??{
      output:"synthetic answer",usage:{prompt_tokens:1000,completion_tokens:100}
    };
  };
  const run=(overrides={})=>runJournaledInferencePrototype({
    env,...fixed,providerBudget,ledger,journal,invokeModel,...overrides
  });
  return {run,trace,sqlite,env,balance:()=>balance,paid:()=>paid,
    invoked:()=>invoked,report:()=>inspectProviderUsageJournal(env),
    events:()=>sqlite.prepare("SELECT event_kind,provider_cost_micro_usd FROM provider_usage_events ORDER BY rowid").all()
  };
}

test("sandbox integration journals dispatch and measured cost before either settlement",async t=>{
  const x=setup(t);
  const result=await x.run();
  assert.equal(result.ok,true);
  assert.equal(result.providerCostMicroUsd,519n);
  assert.equal(result.customerDebitMicrocredits,519n);
  assert.equal(x.balance(),14481n);
  assert.equal(x.paid(),519n);
  assert.equal(x.invoked(),1);
  assert.deepEqual(x.trace,[
    "budget:reserve","wallet:reserve","journal:dispatched","model:invoke",
    "journal:usage_measured","budget:settle","wallet:finalize"
  ]);
  assert.equal((await x.report()).measuredCostMicroUsd,519);
  assert.equal((await x.report()).providerInvoiceVerified,false);
});

test("duplicate request cannot dispatch a second paid provider call or ledger event",async t=>{
  const x=setup(t);
  assert.equal((await x.run()).ok,true);
  const second=await x.run();
  assert.equal(second.ok,false);
  assert.equal(second.modelInvoked,false);
  assert.equal(x.invoked(),1);
  assert.equal(x.paid(),519n);
  assert.equal(x.events().length,2);
});

test("untrusted tariff, oversized preflight and missing adapters fail before any API request",async t=>{
  const x=setup(t);
  const nope=await x.run({tariff:{...tariff,maxCallMicroUsd:10n}});
  assert.equal(nope.reason,"call_spend_ceiling_exceeded");
  assert.deepEqual(x.trace,[]);
  await assert.rejects(x.run({tariff:{...tariff,approved:false}}),/tariff/);
  await assert.rejects(x.run({maxInputTokens:25000}),/bounded integer/);
  await assert.rejects(x.run({attemptId:"email@example.com"}),/IDs/);
  await assert.rejects(x.run({providerBudget:null}),/adapters/);
  assert.equal(x.balance(),15000n);
  assert.equal(x.invoked(),0);
});

test("provider budget denial never consumes wallet, writes journal or invokes AI",async t=>{
  const x=setup(t,{rejectBudget:true});
  const result=await x.run();
  assert.equal(result.reason,"provider_budget_reservation_rejected");
  assert.deepEqual(x.trace,["budget:reserve"]);
  assert.equal(x.balance(),15000n);
  assert.equal(x.events().length,0);
});

test("wallet denial releases definitely unused provider budget to zero",async t=>{
  const x=setup(t,{rejectWallet:true});
  const result=await x.run();
  assert.equal(result.reason,"credit_reservation_rejected");
  assert.deepEqual(x.trace,["budget:reserve","wallet:reserve","budget:settle"]);
  assert.equal(x.balance(),15000n);
  assert.equal(x.paid(),0n);
  assert.equal(x.events().length,0);
});

test("uncertain dispatch journal insertion holds reservations and never calls provider",async t=>{
  const x=setup(t,{failDispatch:true});
  const result=await x.run();
  assert.equal(result.reason,"journal_dispatch_unconfirmed_reservations_held");
  assert.equal(result.modelInvoked,false);
  assert.equal(x.invoked(),0);
  assert.equal(x.balance(),6390n);
  assert.deepEqual(x.trace,["budget:reserve","wallet:reserve","journal:dispatched"]);
  assert.equal(x.paid(),0n);
});

test("provider timeout records unknown outcome but neither settles nor exposes reply",async t=>{
  const x=setup(t,{providerThrows:true});
  const result=await x.run();
  assert.equal(result.reason,"provider_outcome_unknown_reservations_held");
  assert.equal(result.modelInvoked,true);
  assert.equal(x.balance(),6390n);
  assert.equal(x.paid(),0n);
  assert.deepEqual(x.events().map(e=>e.event_kind),["dispatched","outcome_unknown"]);
  assert.equal((await x.report()).unresolvedAttempts,1);
});

test("missing or conflicting usage records uncertainty, never bills measured zero",async t=>{
  for(const response of [
    {output:"no usage"},
    {usage:{prompt_tokens:1000}},
    {usage:{prompt_tokens:1000,completion_tokens:100,input_tokens:900,output_tokens:100}},
    {usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1099}}
  ]){
    const x=setup(t,{response});
    const result=await x.run();
    assert.equal(result.reason,"metering_unverified_reservations_held");
    assert.equal(x.invoked(),1);
    assert.equal(x.paid(),0n);
    assert.equal(x.balance(),6390n);
    assert.deepEqual(x.events().map(e=>e.event_kind),["dispatched","usage_unverified"]);
  }
});

test("measured event storage failure refuses settlement and keeps both reservations",async t=>{
  const x=setup(t,{failMeasured:true});
  const result=await x.run();
  assert.equal(result.reason,"journal_measured_unconfirmed_reservations_held");
  assert.equal(x.invoked(),1);
  assert.equal(x.paid(),0n);
  assert.equal(x.balance(),6390n);
  assert.equal(x.events().length,1);
});

test("excess real measured usage is recorded for review but cannot exceed reserved caps",async t=>{
  const x=setup(t,{response:{usage:{prompt_tokens:24001,completion_tokens:100}}});
  const result=await x.run();
  assert.equal(result.reason,"inference_cost_over_ceiling_reservations_held");
  assert.equal(x.paid(),0n);
  assert.equal(x.balance(),6390n);
  assert.deepEqual(x.events().map(e=>e.event_kind),["dispatched","usage_measured"]);
  assert.equal((await x.report()).measuredAttempts,1);
  // Measured usage recorded DOES NOT mean financial settlement completed.
});

test("provider settlement failure prevents customer finalization and result disclosure",async t=>{
  const x=setup(t,{failBudgetSettle:true});
  const result=await x.run();
  assert.equal(result.reason,"provider_budget_settlement_failed_reservations_held");
  assert.equal(x.balance(),6390n);
  assert.equal(x.paid(),0n);
  assert.equal(x.trace.includes("wallet:finalize"),false);
  assert.equal((await x.report()).measuredAttempts,1);
});

test("wallet settlement failure cannot report a successful paid answer",async t=>{
  const x=setup(t,{failWalletSettle:true});
  const result=await x.run();
  assert.equal(result.reason,"credit_settlement_failed_reservation_held");
  assert.equal(x.balance(),6390n);
  assert.equal(x.paid(),519n);
  assert.equal((await x.report()).measuredAttempts,1);
});

test("all ID references stay opaque and journal schema remains unmodified on policy rejection",async t=>{
  const x=setup(t);
  await assert.rejects(x.run({tariff:{...tariff,provider:"bad/provider"}}),/tariff/);
  assert.equal(x.events().length,0);
  assert.equal(x.invoked(),0);
});

test("Stage 3 default denies spend when verified-plan gate is disabled",async t=>{
  const x=setup(t);
  delete x.env.STAGE3_SYNTHETIC_ONLY;
  const result=await x.run();
  assert.equal(result.ok,false);
  assert.equal(result.reason,"paid_plan_entitlement_disabled");
  assert.equal(result.modelInvoked,false);
  assert.deepEqual(x.trace,[]);
  assert.equal(x.balance(),15000n);
});
test("Stage 3 never permits synthetic bypass while a real AI binding is configured",async t=>{
  const x=setup(t);
  x.env.AI={run:async()=>{throw Error("must not call");}};
  const result=await x.run();
  assert.equal(result.reason,"paid_plan_entitlement_disabled");
  assert.equal(result.modelInvoked,false);
  assert.deepEqual(x.trace,[]);
});
test("Production Wrangler does not enable the synthetic Stage 3 bypass",()=>{
  const {vars={}}=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
  assert.notEqual(vars.STAGE3_SYNTHETIC_ONLY,"true");
});

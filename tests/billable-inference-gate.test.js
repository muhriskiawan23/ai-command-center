import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  quoteBillableInference, measuredModelUsage, runReservedBillableInference
} from "../src/billable-inference-gate.js";

const tariff = Object.freeze({
  approved: true, version: "fixture-v1", provider: "cloudflare-workers-ai",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  inputRateMicroUsdPerMillion: 293000n,
  outputRateMicroUsdPerMillion: 2253000n,
  creditNumerator: 1n, creditDenominator: 1n,
  maxCallMicroUsd: 15000n, maxCallMicrocredits: 15000n
});
const args = { tariff, maxInputTokens: 24000, maxOutputTokens: 700 };
const schema = readFileSync(new URL("../migrations/0012_credit_ledger.sql", import.meta.url), "utf8");
function setup(t, balance = 15000) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  sqlite.prepare("INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES ('member',?,1)").run(balance);
  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...params) {
          return {
            first: async () => statement.get(...params),
            run: async () => ({ meta: { changes: statement.run(...params).changes } })
          };
        }
      };
    }
  };
  const events = [], reserved = new Set();
  const providerBudget = {
    async reserve(entry) {
      events.push(["budgetReserve",entry.id]);
      if (reserved.has(entry.id)) return { ok: false };
      reserved.add(entry.id);
      return { ok:true };
    },
    async settle(entry) {
      events.push(["budgetSettle",entry.id,entry.actualMicroUsd]);
      return { ok:true };
    }
  };
  const get = (sql) => sqlite.prepare(sql).get();
  return { env: { DB }, sqlite, events, providerBudget,
    balance: () => get("SELECT balance_microcredits AS balance FROM credit_accounts WHERE user_id = 'member'").balance,
    journal: () => sqlite.prepare("SELECT delta_microcredits,reason FROM credit_ledger ORDER BY created_at, id").all(),
    reservations: () => get("SELECT count(*) AS n FROM credit_reservations").n };
}
function makeOptions(t, config = {}) {
  const setupResult = setup(t);
  let invoked = 0;
  const invokeModel = async ({model,maxOutputTokens}) => {
    invoked++;
    assert.equal(model,tariff.model);
    assert.equal(maxOutputTokens,args.maxOutputTokens);
    return { response:"valid synthetic answer",usage:{prompt_tokens:1000,completion_tokens:100} };
  };
  return {
    ...setupResult, get invoked(){return invoked;},
    options: {
      env:setupResult.env,userId:"member",requestId:"request-1",...args,
      providerBudget:setupResult.providerBudget,invokeModel,...config
    }
  };
}
test("conservative preflight is exact integer money with an explicit ceiling", () => {
  const quote = quoteBillableInference(args);
  // 24000 x $0.293/M plus 700 x $2.253/M => 8,610 micro-USD (rounded up).
  assert.deepEqual(quote,{allowed:true,maxProviderCostMicroUsd:8610n,reservedMicrocredits:8610n});
  assert.deepEqual(quoteBillableInference({...args,tariff:{...tariff,maxCallMicroUsd:100n}}),
    {allowed:false,reason:"call_spend_ceiling_exceeded"});
  assert.throws(()=>quoteBillableInference({...args,tariff:{...tariff,approved:false}}),/approved/);
  assert.throws(()=>quoteBillableInference({...args,tariff:{...tariff,inputRateMicroUsdPerMillion:null}}),/positive safe bigint/);
  assert.throws(()=>quoteBillableInference({...args,maxInputTokens:24001}),/bounded/);
  assert.throws(()=>quoteBillableInference({...args,maxOutputTokens:0}),/bounded/);
});
test("usage must have real complete non-conflicting token counters", () => {
  assert.deepEqual(measuredModelUsage({usage:{prompt_tokens:10,completion_tokens:3}}),{inputTokens:10,outputTokens:3});
  assert.deepEqual(measuredModelUsage({usage:{input_tokens:3,output_tokens:10}}),{inputTokens:3,outputTokens:10});
  assert.deepEqual(measuredModelUsage({usage:{prompt_tokens:10,completion_tokens:3,
    input_tokens:10,output_tokens:3,total_tokens:13}}),{inputTokens:10,outputTokens:3});
  for (const usage of [{},{prompt_tokens:1},{prompt_tokens:0,completion_tokens:0},
    {prompt_tokens:1,completion_tokens:-1},{prompt_tokens:1.5,completion_tokens:1},
    {prompt_tokens:10,completion_tokens:3,input_tokens:12,output_tokens:3},
    {prompt_tokens:10,completion_tokens:3,input_tokens:99},
    {prompt_tokens:10,completion_tokens:3,input_tokens:10,output_tokens:-1},
    {prompt_tokens:10,completion_tokens:3,total_tokens:12},
    {prompt_tokens:10,completion_tokens:3,total_tokens:NaN},
    {prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:2},
    {input_tokens:8,output_tokens:2,prompt_tokens:8}])
    assert.equal(measuredModelUsage({usage}),null);
  assert.equal(measuredModelUsage({response:"no counters"}),null);
});
test("real SQLite ledger reserves before inference, settles measured usage and prevents double charging", async t => {
  const x=makeOptions(t), quote=quoteBillableInference(args);
  const output=await runReservedBillableInference(x.options);
  assert.equal(output.ok,true);
  assert.equal(output.providerCostMicroUsd,519n);
  assert.equal(output.customerDebitMicrocredits,519n);
  assert.equal(x.balance(),15000-519);
  assert.equal(x.reservations(),1);
  assert.deepEqual(x.journal().map(j=>j.delta_microcredits).sort((a,b)=>a-b),[-8610,8091]);
  assert.equal(x.invoked,1);
  assert.deepEqual(x.events.map(e=>e[0]),["budgetReserve","budgetSettle"]);
  const replay=await runReservedBillableInference(x.options);
  assert.equal(replay.ok,false);
  assert.equal(x.invoked,1);
  assert.equal(x.balance(),15000-519);
  assert.equal(x.journal().length,2);
  assert.equal(replay.modelInvoked,false);
  assert.equal(quote.reservedMicrocredits,8610n);
});
test("unapproved or over-ceiling calls never consume budget, balance or invoke AI", async t => {
  const x=makeOptions(t);
  const denied=await runReservedBillableInference({...x.options,tariff:{...tariff,maxCallMicroUsd:10n}});
  assert.deepEqual(denied,{ok:false,reason:"call_spend_ceiling_exceeded",modelInvoked:false});
  assert.equal(x.invoked,0);assert.equal(x.balance(),15000);assert.deepEqual(x.events,[]);
});
test("missing provider daily budget is a hard preflight error", async t => {
  const x=makeOptions(t);
  await assert.rejects(runReservedBillableInference({...x.options,providerBudget:null}),/atomic provider budget/);
  assert.equal(x.invoked,0);assert.equal(x.balance(),15000);
});
test("budget rejection fails closed before ledger or provider", async t => {
  const x=makeOptions(t,{providerBudget:{reserve:async()=>({ok:false}),settle:async()=>({ok:true})}});
  const result=await runReservedBillableInference(x.options);
  assert.equal(result.reason,"provider_budget_rejected");
  assert.equal(x.invoked,0);assert.equal(x.reservations(),0);
});
test("credit rejection releases reserved global budget without invoking model", async t => {
  const x=makeOptions(t);
  x.sqlite.exec("UPDATE credit_accounts SET balance_microcredits=1 WHERE user_id='member'");
  const result=await runReservedBillableInference(x.options);
  assert.equal(result.reason,"credit_reservation_rejected");
  assert.equal(x.invoked,0);
  assert.deepEqual(x.events.map(e=>e[0]),["budgetReserve","budgetSettle"]);
  assert.equal(x.events[1][2],0n);
  assert.equal(x.balance(),1);
});
test("missing measured usage holds the reservation; never treats cost as zero", async t => {
  const x=makeOptions(t,{invokeModel:async()=>({response:"answer without billing usage"})});
  const output=await runReservedBillableInference(x.options);
  assert.equal(output.reason,"metering_unverified_reservations_held");
  assert.equal(x.balance(),15000-8610);
  assert.equal(x.journal().length,1);
  assert.deepEqual(x.events.map(e=>e[0]),["budgetReserve"]);
});
test("provider timeout or unknown outcome holds reserved credits", async t => {
  const x=makeOptions(t,{invokeModel:async()=>{throw Error("network timeout");}});
  const output=await runReservedBillableInference(x.options);
  assert.equal(output.reason,"provider_outcome_unknown_reservations_held");
  assert.equal(x.balance(),15000-8610);
  assert.equal(x.journal().length,1);
  assert.equal(x.events.length,1);
});
test("oversized measured usage cannot exceed prepaid maximum", async t => {
  const x=makeOptions(t,{invokeModel:async()=>({usage:{prompt_tokens:24001,completion_tokens:1}})});
  const result=await runReservedBillableInference(x.options);
  assert.equal(result.reason,"metering_unverified_reservations_held");
  assert.equal(x.journal().length,1);
  assert.equal(x.events.length,1);
});
test("budget settlement failure does not finalize the customer's debit", async t => {
  const x=makeOptions(t,{providerBudget:{reserve:async()=>({ok:true}),settle:async()=>({ok:false})}});
  const result=await runReservedBillableInference(x.options);
  assert.equal(result.reason,"provider_budget_settlement_failed_reservations_held");
  assert.equal(x.balance(),15000-8610);
  assert.equal(x.journal().length,1);
});
test("ledger settlement failure is not reported as a successful paid answer", async t => {
  const x=makeOptions(t);
  const rejectFinalize={reserve:async(...a)=>{const {reserveCredits}=await import("../src/credit-ledger.js");return reserveCredits(...a);},
    finalize:async()=>({ok:false})};
  const result=await runReservedBillableInference({...x.options,ledger:rejectFinalize});
  assert.equal(result.reason,"credit_settlement_failed_reservation_held");
  assert.equal(x.balance(),15000-8610);
  assert.equal(x.journal().length,1);
});

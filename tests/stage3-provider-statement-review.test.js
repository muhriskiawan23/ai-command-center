// Synthetic-only Stage 3 provider statement arithmetic checks. Never reads
// external invoices or touches real Cloudflare D1, Midtrans or user money.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { appendProviderUsageEvent } from "../src/provider-usage-journal.js";
import {
  inspectStage3InternalDailyCosts,compareStage3ProviderStatement
} from "../src/stage3-provider-statement-review.js";

const now=1_735_000_000_000;
const day=new Date(now).toISOString().slice(0,10);
const nextDay=new Date(Date.parse(day+"T00:00:00Z")+86400000).toISOString().slice(0,10);
const tariff={
  approved:true,provider:"cloudflare-workers-ai",
  model:"@cf/synthetic-invoice",version:"synthetic-cost-v1",
  inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n
};
function fixture(t) {
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  for(const name of ["0012_credit_ledger","0013_provider_spend_budget","0014_provider_usage_journal"])
    db.exec(readFileSync(new URL("../migrations/"+name+".sql",import.meta.url),"utf8"));
  let reads=0,writes=0;
  const statement=(sql,params=[])=>({
    bind(...a){return statement(sql,a);},
    async all(){reads++;return{success:true,results:db.prepare(sql).all(...params)};},
    async first(){reads++;return db.prepare(sql).get(...params);}
  });
  const env={DB:{prepare(sql){return statement(sql)}}};
  async function event(requestId,attemptId,kind,usage={prompt_tokens:1000,completion_tokens:100}) {
    const result=await appendProviderUsageEvent(env,{
      requestId,attemptId,kind,provider:tariff.provider,
      model:tariff.model,rateVersion:tariff.version,
      nowMs:now,
      ...(kind==="usage_measured"?{usage,tariff}:{})
    });
    assert.equal(result.ok,true);
    writes++;
  }
  async function measured(requestId,attemptId){
    await event(requestId,attemptId,"dispatched");
    await event(requestId,attemptId,"usage_measured");
  }
  async function snapshot(){
    const before=writes;
    const snap=await inspectStage3InternalDailyCosts(env,{startUtcDay:day,endUtcDay:nextDay});
    assert.equal(writes,before,"read-only audit cannot mutate financial data");
    return snap;
  }
  return {db,env,measured,event,snapshot,stats:()=>({reads,writes})};
}
function statement(row,amount=row.internalCostMicroUsd) {
  return {utcDay:row.utcDay,provider:row.provider,model:row.model,
    statementCostMicroUsd:amount};
}
test("exact daily provider cost from immutable synthetic per-attempt journal",async t=>{
  const x=fixture(t);
  await x.measured("req1","attempt1");
  await x.measured("req2","attempt2");
  const report=await x.snapshot();
  assert.equal(report.rows.length,1);
  assert.equal(report.rows[0].internalCostMicroUsd,1038);
  assert.equal(report.rows[0].dispatchedAttempts,2);
  assert.equal(report.rows[0].measuredAttempts,2);
  assert.equal(report.rows[0].unresolvedAttempts,0);
  assert.equal(report.providerInvoiceVerified,false);
  assert.equal(report.operatorActionAuthorized,false);
  const text=JSON.stringify(report);
  assert.equal(text.includes("req1"),false);
  assert.equal(text.includes("attempt1"),false);
  assert.equal(text.includes("synthetic-owner"),false);
});
test("even identical user-supplied statement arithmetic is NOT provider invoice verification",async t=>{
  const x=fixture(t);await x.measured("req1","attempt1");
  const internalSnapshot=await x.snapshot();
  const result=compareStage3ProviderStatement({
    internalSnapshot,statementRows:[statement(internalSnapshot.rows[0])]
  });
  assert.equal(result.arithmeticMatch,true);
  assert.equal(result.reviewRequired,false);
  assert.equal(result.providerInvoiceVerified,false);
  assert.equal(result.operatorActionAuthorized,false);
});
test("unknown upstream attempt keeps statement reconciliation under review",async t=>{
  const x=fixture(t);
  await x.measured("req1","attempt1");
  await x.event("req2","attempt2","dispatched");
  await x.event("req2","attempt2","outcome_unknown");
  const snap=await x.snapshot();
  assert.equal(snap.rows[0].internalCostMicroUsd,519);
  assert.equal(snap.rows[0].unresolvedAttempts,1);
  const result=compareStage3ProviderStatement({
    internalSnapshot:snap,statementRows:[statement(snap.rows[0])]
  });
  assert.equal(result.arithmeticMatch,false);
  assert.equal(result.unresolvedAttempts,1);
  assert.equal(result.reviewRequired,true);
});
test("missing, extra and unequal statement groups are reported without auto-settlement",async t=>{
  const x=fixture(t);await x.measured("req1","attempt1");
  const snap=await x.snapshot();
  const missing=compareStage3ProviderStatement({internalSnapshot:snap,statementRows:[]});
  assert.equal(missing.missingStatementGroups,1);
  assert.equal(missing.reviewRequired,true);
  const mismatch=compareStage3ProviderStatement({
    internalSnapshot:snap,statementRows:[statement(snap.rows[0],520)]
  });
  assert.equal(mismatch.mismatchedCostGroups,1);
  const extra=compareStage3ProviderStatement({
    internalSnapshot:snap,statementRows:[
      statement(snap.rows[0]),
      {...statement(snap.rows[0]),model:"@cf/unknown"}
    ]
  });
  assert.equal(extra.unexpectedStatementGroups,1);
  assert.equal(extra.providerInvoiceVerified,false);
});
test("duplicate statement keys, fractional money and fabricated provenance are invalid",async t=>{
  const x=fixture(t);await x.measured("req1","attempt1");
  const snap=await x.snapshot(),row=statement(snap.rows[0]);
  assert.throws(()=>compareStage3ProviderStatement({
    internalSnapshot:snap,statementRows:[row,row]
  }),/Duplicate/);
  assert.throws(()=>compareStage3ProviderStatement({
    internalSnapshot:snap,statementRows:[{...row,statementCostMicroUsd:0.1}]
  }),/Exact integer/);
  assert.throws(()=>compareStage3ProviderStatement({
    internalSnapshot:{...snap,providerInvoiceVerified:true},statementRows:[row]
  }),/unverified/);
  assert.throws(()=>compareStage3ProviderStatement({
    internalSnapshot:{...snap,rows:[...snap.rows,...snap.rows]},statementRows:[row]
  }),/Duplicate internal/);
});
test("invalid date ranges and missing D1 snapshot fail closed",async t=>{
  const x=fixture(t);
  await assert.rejects(inspectStage3InternalDailyCosts(x.env,{
    startUtcDay:"2026-02-30",endUtcDay:"2026-03-01"
  }),/Valid UTC date/);
  await assert.rejects(inspectStage3InternalDailyCosts(x.env,{
    startUtcDay:day,endUtcDay:day
  }),/Date window/);
  await assert.rejects(inspectStage3InternalDailyCosts(x.env,{
    startUtcDay:"2026-01-01",endUtcDay:"2026-05-01"
  }),/Date window/);
  await assert.rejects(inspectStage3InternalDailyCosts({DB:{prepare(){throw Error("offline")}}},{
    startUtcDay:day,endUtcDay:nextDay
  }),/offline/);
  await assert.rejects(inspectStage3InternalDailyCosts({
    DB:{prepare(){return{bind(){return{all:async()=>({results:null})}}}}}
  },{startUtcDay:day,endUtcDay:nextDay}),/Incomplete/);
});

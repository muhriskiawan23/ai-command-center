import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {inspectStage3ProviderStatement} from "../src/stage3-provider-statement-reconciliation.js";

const T=1_800_000_000;
const statement={
  provider:"cloudflare-workers-ai",statementSha256:"c".repeat(64),
  currency:"USD",usageScope:"aggregate",periodStartSeconds:T-50,
  periodEndSeconds:T+50,billedMicroUsd:519
};
function setup(t){
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  db.exec(readFileSync(new URL("../migrations/0014_provider_usage_journal.sql",import.meta.url),"utf8"));
  const env={DB:{prepare(sql){return{bind(...args){return{
    first:async()=>db.prepare(sql).get(...args)
  }};}}}};
  const event=(request,attempt,kind,cost=null,at=T)=>{
    db.prepare(`INSERT INTO provider_usage_events
     (attempt_id,event_kind,request_id,provider,model,rate_version,
     input_tokens,output_tokens,provider_cost_micro_usd,created_at)
     VALUES (?,?,?,'cloudflare-workers-ai','fictional-model','test-v1',?,?,?,?)`)
      .run(attempt,kind,request,
        kind==="usage_measured"?1000:null,
        kind==="usage_measured"?100:null,cost,at);
  };
  const measure=(request="r1",attempt="a1",cost=519)=>{
    event(request,attempt,"dispatched");
    event(request,attempt,"usage_measured",cost);
  };
  const verifyStatement=async binding=>({...binding,verified:true});
  const inspect=(overrides={},verify=verifyStatement)=>inspectStage3ProviderStatement(
    env,{statement:{...statement,...overrides},verifyStatement:verify});
  return {db,env,event,measure,inspect};
}
function locked(result){
  assert.equal(result.reviewRequired,true);
  assert.equal(result.providerInvoiceVerified,false);
  assert.equal(result.statementPeriodComplete,false);
  assert.equal(result.perAttemptInvoiceReconciled,false);
  assert.equal(result.financialActionAuthorized,false);
  assert.equal(result.customerDebitAuthorized,false);
  assert.equal(result.holdReleaseAuthorized,false);
  assert.equal(JSON.stringify(result).includes("r1"),false);
  assert.equal(JSON.stringify(result).includes("a1"),false);
}
test("matching synthetic aggregate totals stay READ-ONLY and cannot release holds",async t=>{
  const x=setup(t);x.measure();
  const before=x.db.prepare("SELECT total_changes() AS n").get().n;
  const r=await x.inspect();
  assert.equal(r.statementSourceVerified,true);
  assert.equal(r.aggregateAmountMatches,true);
  assert.equal(r.reason,"aggregate_match_not_per_attempt_evidence");
  assert.equal(r.measuredAttempts,1);
  locked(r);
  assert.equal(x.db.prepare("SELECT total_changes() AS n").get().n,before);
});
test("mismatched provider total stays unresolved even for source-verified statement",async t=>{
  const x=setup(t);x.measure();
  const r=await x.inspect({billedMicroUsd:518});
  assert.equal(r.aggregateAmountMatches,false);
  assert.equal(r.reason,"aggregate_cost_mismatch");
  locked(r);
});
test("provider source not verified or not exactly bound fails closed",async t=>{
  const x=setup(t);x.measure();
  const cases=[
    async()=>({verified:true}),
    async b=>({...b,verified:true,statementSha256:"d".repeat(64)}),
    async b=>({...b,verified:true,periodEndSeconds:T+80}),
    async()=>{throw new Error("provider invoice unavailable")},
    async()=>null
  ];
  for(const verifier of cases){
    const r=await x.inspect({},verifier);
    assert.equal(r.statementSourceVerified,false);
    assert.equal(r.aggregateAmountMatches,false);
    assert.equal(r.reason,"provider_statement_source_unverified");
    locked(r);
  }
});
test("unknown or unverified provider outcomes must never be treated as free",async t=>{
  for(const kind of ["outcome_unknown","usage_unverified"]){
    const x=setup(t);x.event("r1","a1","dispatched");x.event("r1","a1",kind);
    const r=await x.inspect({billedMicroUsd:0});
    assert.equal(r.reason,"unresolved_provider_cost");
    assert.equal(r.aggregateAmountMatches,false);
    assert.equal(r.unmeasuredDispatches,1);
    locked(r);
  }
});
test("missing measured usage and empty invoice period are not clean",async t=>{
  const x=setup(t);
  const empty=await x.inspect({billedMicroUsd:0});
  assert.equal(empty.reason,"incomplete_provider_usage_window");
  locked(empty);
  x.event("r1","a1","dispatched");
  const missing=await x.inspect({billedMicroUsd:0});
  assert.equal(missing.reason,"unresolved_provider_cost");
  locked(missing);
});
test("out-of-window usage cannot be silently counted toward an invoice",async t=>{
  const x=setup(t);
  x.event("r1","a1","dispatched",null,T-100);
  x.event("r1","a1","usage_measured",519,T-100);
  const r=await x.inspect({billedMicroUsd:0});
  assert.equal(r.dispatchedAttempts,0);
  assert.equal(r.measuredAttempts,0);
  assert.equal(r.aggregateAmountMatches,false);
  locked(r);
});
test("invalid statement clock, currency, source and amount fail before queries",async t=>{
  const x=setup(t);x.measure();
  for(const change of [
    {currency:"IDR"},{usageScope:"per_attempt"},
    {provider:{toString:()=>statement.provider}},
    {periodEndSeconds:statement.periodStartSeconds},
    {periodEndSeconds:statement.periodStartSeconds+32*86400},
    {billedMicroUsd:-1},{billedMicroUsd:0.5},
    {statementSha256:"invalid"}
  ]) {
    await assert.rejects(x.inspect(change),TypeError);
  }
  await assert.rejects(inspectStage3ProviderStatement(x.env,{}),TypeError);
});
test("missing journal tables or malformed SQL results fail without a green verdict",async t=>{
  const x=setup(t);
  x.db.exec("DROP TABLE provider_usage_events");
  await assert.rejects(x.inspect(),/no such table/);
  const bad={DB:{prepare(){return{bind(){return{first:async()=>({dispatchedAttempts:-1})}}}}}};
  await assert.rejects(inspectStage3ProviderStatement(bad,{
    statement,verifyStatement:async b=>({...b,verified:true})
  }),/snapshot unavailable/);
});

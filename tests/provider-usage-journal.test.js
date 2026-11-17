import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  appendProviderUsageEvent, inspectProviderUsageJournal, strictProviderTokenUsage
} from "../src/provider-usage-journal.js";

const migration=readFileSync(
  new URL("../migrations/0014_provider_usage_journal.sql",import.meta.url),"utf8");
const tariff={
  approved:true,version:"test-only-v1",provider:"workers-ai",model:"@cf/meta/test",
  inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n
};
const base={
  attemptId:"att:test-one",requestId:"req:test-one",provider:tariff.provider,
  model:tariff.model,rateVersion:tariff.version,nowMs:Date.UTC(2026,10,17,2,0)
};
function fixture(t) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  sqlite.exec(migration);
  const env={DB:{prepare(sql){
    return {
      bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)};},
      first:async()=>sqlite.prepare(sql).get()
    };
  }}};
  const entries=()=>sqlite.prepare(
    "SELECT event_kind,input_tokens,output_tokens,provider_cost_micro_usd "+
    "FROM provider_usage_events ORDER BY created_at,event_kind").all();
  return {sqlite,env,entries,
    append:(kind,extra={})=>appendProviderUsageEvent(env,{...base,kind,...extra}),
    inspect:()=>inspectProviderUsageJournal(env)};
}

test("Stage 3 journal tracks dispatch then measured cost with trusted exact tariff",async t=>{
  const x=fixture(t);
  assert.deepEqual(await x.append("dispatched"),{ok:true,eventKind:"dispatched"});
  assert.deepEqual(await x.append("usage_measured",{
    tariff,usage:{prompt_tokens:1000,completion_tokens:100}
  }),{ok:true,eventKind:"usage_measured"});
  const data=x.entries();
  assert.equal(data.length,2);
  const measured=data.find(e=>e.event_kind==="usage_measured");
  assert.equal(measured.input_tokens,1000);
  assert.equal(measured.output_tokens,100);
  assert.equal(measured.provider_cost_micro_usd,519);
  const report=await x.inspect();
  assert.deepEqual(report,{
    scope:"inactive_provider_usage_journal_only",
    dispatchedAttempts:1,measuredAttempts:1,unknownEvents:0,
    usageUnverifiedEvents:0,measuredCostMicroUsd:519,
    unresolvedAttempts:0,reviewRequired:false,providerInvoiceVerified:false
  });
});

test("journal requires a matching earlier dispatch, cannot replay or re-bill",async t=>{
  const x=fixture(t);
  assert.equal((await x.append("usage_measured",{
    tariff,usage:{prompt_tokens:1000,completion_tokens:100}
  })).ok,false);
  assert.equal((await x.append("dispatched")).ok,true);
  assert.equal((await x.append("dispatched")).ok,false);
  assert.equal((await x.append("usage_measured",{
    requestId:"req:someone-else",tariff,usage:{prompt_tokens:1000,completion_tokens:100}
  })).ok,false);
  assert.equal((await x.append("usage_measured",{
    tariff,usage:{input_tokens:1000,output_tokens:100}
  })).ok,true);
  assert.equal((await x.append("usage_measured",{
    tariff,usage:{input_tokens:1000,output_tokens:100}
  })).ok,false);
  assert.equal(x.entries().length,2);
});

test("uncertain outcomes preserve historical evidence and remain unresolved",async t=>{
  const x=fixture(t);
  await x.append("dispatched");
  assert.equal((await x.append("outcome_unknown")).ok,true);
  let report=await x.inspect();
  assert.equal(report.unresolvedAttempts,1);
  assert.equal(report.unknownEvents,1);
  assert.equal(report.measuredCostMicroUsd,0); // unmeasured is NOT zero billing
  assert.equal(report.providerInvoiceVerified,false);
  assert.equal(report.reviewRequired,true);
  assert.equal((await x.append("usage_unverified")).ok,true);
  assert.equal((await x.append("outcome_unknown")).ok,false);
  assert.equal((await x.append("usage_measured",{
    tariff,usage:{prompt_tokens:1000,completion_tokens:100}
  })).ok,true);
  report=await x.inspect();
  assert.equal(report.unknownEvents,1); // original uncertainty stays in history
  assert.equal(report.unresolvedAttempts,0);
  assert.equal(report.reviewRequired,false);
  assert.equal((await x.append("outcome_unknown")).ok,false);
});

test("partial, inconsistent, negative, zero or estimated usage never journals cost",async t=>{
  const x=fixture(t);
  await x.append("dispatched");
  for(const usage of [
    undefined,{}, {prompt_tokens:1000},
    {prompt_tokens:1000,completion_tokens:-1},
    {prompt_tokens:1000,completion_tokens:2.1},
    {prompt_tokens:0,completion_tokens:0},
    {input_tokens:1000,output_tokens:100,prompt_tokens:1000,completion_tokens:101},
    {input_tokens:1000,output_tokens:100,prompt_tokens:1000},
    {input_tokens:"1000",output_tokens:100},
    {prompt_tokens:1000,completion_tokens:100,total_tokens:1099},
    {prompt_tokens:1000,completion_tokens:100,total_tokens:"1100"}
  ]) {
    assert.deepEqual(await x.append("usage_measured",{tariff,usage}),
      {ok:false,reason:"authoritative_usage_unverified"});
  }
  assert.equal(x.entries().length,1);
  assert.equal((await x.inspect()).unresolvedAttempts,1);
});

test("a server-approved exact policy is mandatory; client fees cannot choose costs",async t=>{
  const x=fixture(t);
  await x.append("dispatched");
  const usage={prompt_tokens:1000,completion_tokens:100};
  for(const wrong of [
    {...tariff,approved:false},
    {...tariff,model:"other-model"},
    {...tariff,version:"other-tariff"},
    {...tariff,provider:"other-provider"}
  ]) await assert.rejects(x.append("usage_measured",{tariff:wrong,usage}),
    /Server-approved matching tariff required/);
  await assert.rejects(x.append("usage_measured",{tariff:{...tariff,inputRateMicroUsdPerMillion:0n},usage}),
    /Nonzero measured rate required/);
  assert.equal(x.entries().length,1);
  const overflow=await x.append("usage_measured",{
    tariff:{...tariff,inputRateMicroUsdPerMillion:BigInt(Number.MAX_SAFE_INTEGER)},
    usage:{prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:10}
  });
  assert.equal(overflow.reason,"measured_cost_overflow");
  assert.equal(x.entries().length,1);
});

test("append-only SQLite triggers prevent rewriting or deleting billed history",async t=>{
  const x=fixture(t);
  await x.append("dispatched");
  await x.append("usage_measured",{tariff,usage:{prompt_tokens:1000,completion_tokens:100}});
  assert.throws(()=>x.sqlite.exec(
    "UPDATE provider_usage_events SET provider_cost_micro_usd=0 WHERE event_kind='usage_measured'"),
    /usage_event_append_only/);
  assert.throws(()=>x.sqlite.exec("DELETE FROM provider_usage_events"),/usage_event_append_only/);
  assert.equal(x.entries().length,2);
});

test("database-level CHECK rejects fabricated zero-cost or unmatched token events",t=>{
  const x=fixture(t);
  const insert=x.sqlite.prepare(
    "INSERT INTO provider_usage_events "+
    "(attempt_id,event_kind,request_id,provider,model,rate_version,input_tokens,output_tokens,provider_cost_micro_usd,created_at) "+
    "VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  insert.run("a","dispatched","r","p","m","v",null,null,null,1);
  assert.throws(()=>insert.run("a","usage_measured","r","p","m","v",null,null,0,1),
    /CHECK constraint/);
  assert.throws(()=>insert.run("a","usage_measured","r","p","m","v",1000,100,0,1),
    /CHECK constraint/);
  assert.throws(()=>insert.run("a","outcome_unknown","r","p","m","v",0,0,0,1),
    /CHECK constraint/);
});

test("untrusted IDs/PII strings or unknown event kinds fail before writing",async t=>{
  const x=fixture(t);
  for(const opts of [
    {attemptId:"someone@example.com"},{requestId:"not a safe id"},
    {provider:"../../../api"},{kind:"settled"},{nowMs:-1}
  ]) {
    await assert.rejects(appendProviderUsageEvent(x.env,{
      ...base,kind:"dispatched",...opts
    }),/bounded opaque|Recognized journal|timestamp/);
  }
  assert.equal(x.entries().length,0);
});

test("read-only audit never mutates tables or returns per-request identifiers",async t=>{
  const x=fixture(t);
  await x.append("dispatched");
  const before=x.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const report=await x.inspect();
  const after=x.sqlite.prepare("SELECT total_changes() AS n").get().n;
  assert.equal(before,after);
  assert.equal(JSON.stringify(report).includes("req:test-one"),false);
  assert.equal(report.unresolvedAttempts,1);
  await assert.rejects(inspectProviderUsageJournal({}),/D1 database binding required/);
});

test("missing D1 schema or storage fails closed without fabricating a clean journal",async t=>{
  const empty=new DatabaseSync(":memory:");
  t.after(()=>empty.close());
  const env={DB:{prepare(sql){return{first:async()=>empty.prepare(sql).get()};}}};
  await assert.rejects(inspectProviderUsageJournal(env),/no such table/);
  assert.equal((await appendProviderUsageEvent(env,{...base,kind:"dispatched"})).ok,false);
});

test("strict token parser accepts both matching provider aliases",()=>{
  assert.deepEqual(strictProviderTokenUsage({
    prompt_tokens:1000,completion_tokens:100,input_tokens:1000,output_tokens:100,
    total_tokens:1100
  }),{inputTokens:1000,outputTokens:100});
  assert.deepEqual(strictProviderTokenUsage({input_tokens:1000,output_tokens:100}),
    {inputTokens:1000,outputTokens:100});
});

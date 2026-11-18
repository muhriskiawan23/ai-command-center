import test from "node:test";
import assert from "node:assert/strict";
import {costliestDailyMix,assessFreeTierExposure} from "../evaluation/free-tier-usage-exposure.js";
import {DAILY_LIMIT_DEFAULTS,MULTI_AGENT_UNITS} from "../src/daily-limits.js";
import {modelCostMicroUsd,quoteRequest,CREDIT_POLICY} from "../evaluation/bor-ai-credit-scenarios.js";

const defaults=Object.freeze({
  guestUnits:DAILY_LIMIT_DEFAULTS.guest,
  loggedInUnits:DAILY_LIMIT_DEFAULTS.user,
  globalUnits:DAILY_LIMIT_DEFAULTS.global,
  multiAgentUnits:MULTI_AGENT_UNITS,
  ordinaryMicroUsd:modelCostMicroUsd({inputTokens:2000,outputTokens:500}),
  multiAgentMicroUsd:quoteRequest({
    modelCalls:[{inputTokens:2000,outputTokens:500},{inputTokens:2000,outputTokens:500}],
    tavilyApiCredits:1
  }).totalMicroUsd,
  periodDays:30,
  basicListPriceMicroUsd:CREDIT_POLICY.plans.basic.usdCents*10000n,
  proListPriceMicroUsd:CREDIT_POLICY.plans.pro.usdCents*10000n
});
test("synthetic multi-agent cost can dwarf approved Basic/Pro prices under current Free defaults",()=>{
  assert.equal(defaults.ordinaryMicroUsd,1713n);
  assert.equal(defaults.multiAgentMicroUsd,11426n);
  assert.equal(defaults.loggedInUnits,150);
  assert.equal(defaults.multiAgentUnits,3);
  const r=assessFreeTierExposure(defaults);
  assert.equal(r.scenarioOnly,true);
  assert.equal(r.loggedInDaily.ordinaryCalls,0);
  assert.equal(r.loggedInDaily.multiAgentCalls,50);
  assert.equal(r.loggedInPeriodMicroUsd,17139000n);
  assert.equal(r.guestPeriodMicroUsd,1713900n);
  assert.equal(r.globalPeriodMicroUsd,171390000n);
  assert.equal(r.loggedInScenarioExceedsBasicListPrice,true);
  assert.equal(r.loggedInScenarioExceedsProListPrice,true);
});
test("ordinary requests dominate if multi-agent costs less per unit",()=>{
  const mix=costliestDailyMix({dailyUnits:10,multiAgentUnits:3,ordinaryMicroUsd:10n,multiAgentMicroUsd:29n});
  assert.deepEqual([mix.ordinaryCalls,mix.multiAgentCalls,mix.dailyMicroUsd],[10,0,100n]);
});
test("fixed-cost max mix has integral multi-agent requests and leftover ordinary units",()=>{
  const mix=costliestDailyMix({dailyUnits:11,multiAgentUnits:3,ordinaryMicroUsd:10n,multiAgentMicroUsd:31n});
  assert.deepEqual([mix.ordinaryCalls,mix.multiAgentCalls,mix.dailyMicroUsd],[2,3,113n]);
});
test("global unit cap bounds individual request capacity in a single-user scenario",()=>{
  const r=assessFreeTierExposure({...defaults,guestUnits:30,loggedInUnits:150,globalUnits:2});
  assert.equal(r.loggedInDaily.dailyUnits,2);
  assert.equal(r.loggedInDaily.ordinaryCalls,2);
  assert.equal(r.loggedInPeriodMicroUsd,102780n);
});
test("unknown unit costs, unsafe unit counts and overflow are rejected",()=>{
  assert.throws(()=>assessFreeTierExposure({...defaults,ordinaryMicroUsd:undefined}),/safe bigint/);
  assert.throws(()=>assessFreeTierExposure({...defaults,loggedInUnits:0}),/positive safe integer/);
  assert.throws(()=>assessFreeTierExposure({...defaults,multiAgentUnits:1.5}),/positive safe integer/);
  assert.throws(()=>assessFreeTierExposure({...defaults,multiAgentMicroUsd:-1n}),/safe bigint/);
  assert.throws(()=>assessFreeTierExposure({...defaults,periodDays:367}),/not exceed/);
  assert.throws(()=>assessFreeTierExposure({...defaults,ordinaryMicroUsd:BigInt(Number.MAX_SAFE_INTEGER)}),/safe micro-USD range/);
});

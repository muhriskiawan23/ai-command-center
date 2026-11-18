import test from "node:test";
import assert from "node:assert/strict";
import {assessPlanSolvency} from "../evaluation/bor-ai-plan-solvency.js";
const base={
  plan:"basic",lockedFxIdrPerUsd:18260,gatewayFeeIdr:4000,gatewayFeeTaxBps:1200,
  revenueTaxBps:0,fxLeakageBps:200,refundReserveBps:500,providerOverrunBps:10000,
  otherVariableMicroUsd:100000,monthlyFixedMicroUsd:20000000,
  monthlyFreeSubsidyMicroUsd:5000000,payingAccounts:100,
  rolloverCredits:0,outstandingTopupCredits:0,requiredMarginBps:3000
};
test("USD Basic/Pro full-consumption review includes overhead, Free and 2x provider stress",()=>{
  const basic=assessPlanSolvency(base);
  assert.equal(basic.grossMicroUsd,1990000n);
  assert.equal(basic.grossIdr,36338n);
  assert.equal(basic.gatewayCostMicroUsd,245346n);
  assert.equal(basic.providerCostMicroUsd,600000n);
  assert.equal(basic.allocatedFixedMicroUsd,250000n);
  assert.equal(basic.totalCostMicroUsd,1334646n);
  assert.equal(basic.remainingMicroUsd,655354n);
  assert.equal(basic.passesScenarioGate,true);
  assert.equal(basic.breakEvenAccounts,28n);
  const pro=assessPlanSolvency({...base,plan:"pro"});
  assert.equal(pro.providerCostMicroUsd,3000000n);
  assert.equal(pro.remainingMicroUsd,2905354n);
  assert.equal(pro.passesScenarioGate,true);
  assert.equal(pro.breakEvenAccounts,8n);
  assert.equal(pro.canActivateBilling,false);
});
test("early cohorts can lose money despite positive provider-only unit margins",()=>{
  for(const payingAccounts of [1,10]){
    const x=assessPlanSolvency({...base,payingAccounts});
    assert.equal(x.passesScenarioGate,false);
    assert.ok(x.remainingMicroUsd<0n);
    assert.equal(x.maxRolloverCredits,0n);
  }
});
test("maximum rollover is computed after current grants and all outstanding topup obligations",()=>{
  const x=assessPlanSolvency(base);
  assert.equal(x.maximumAffordableCredits,3291n);
  assert.equal(x.maxRolloverCredits,291n);
  assert.equal(assessPlanSolvency({...base,rolloverCredits:291}).passesScenarioGate,true);
  assert.equal(assessPlanSolvency({...base,rolloverCredits:292}).passesScenarioGate,false);
  assert.equal(assessPlanSolvency({...base,outstandingTopupCredits:292}).passesScenarioGate,false);
  assert.equal(assessPlanSolvency({...base,outstandingTopupCredits:300}).maxRolloverCredits,0n);
  assert.equal(x.rolloverEnabled,false);
});
test("high merchant fees, adverse FX, taxes and Free subsidy cannot silently pass",()=>{
  for(const overrides of [
    {gatewayFeeIdr:40000},{lockedFxIdrPerUsd:5000},
    {revenueTaxBps:5000},{monthlyFreeSubsidyMicroUsd:1000000000}
  ])assert.equal(assessPlanSolvency({...base,...overrides}).passesScenarioGate,false);
  const impossible=assessPlanSolvency({...base,gatewayFeeIdr:40000});
  assert.equal(impossible.breakEvenAccounts,null);
});
test("missing costs, unsafe amounts, prototype plan names and zero cohorts fail closed",()=>{
  for(const key of Object.keys(base))
    assert.throws(()=>assessPlanSolvency({...base,[key]:undefined}));
  for(const overrides of [
    {plan:"__proto__"},{plan:"free"},{payingAccounts:0},
    {lockedFxIdrPerUsd:0},{rolloverCredits:-1},
    {outstandingTopupCredits:0.1},{providerOverrunBps:10001},
    {monthlyFixedMicroUsd:Number.MAX_SAFE_INTEGER+1}
  ])assert.throws(()=>assessPlanSolvency({...base,...overrides}));
});

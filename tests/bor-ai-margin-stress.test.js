import test from "node:test";
import assert from "node:assert/strict";
import {assessCandidateMargin} from "../evaluation/bor-ai-margin-stress.js";
const base=Object.freeze({
  grossIdr:36_338,gatewayFeeIdr:4_000,providerAllowanceIdr:5_478,
  gatewayFeeTaxBps:1_200,fxLeakageBps:200,refundAndChargebackReserveBps:500,
  providerOverrunBps:0,otherVariableCostsIdr:2_000,requiredContributionBps:4_000
});
test("Basic bank VA stress includes tax, FX, reserve and other variable costs",()=>{
  const x=assessCandidateMargin(base);
  assert.equal(x.gatewayFeeTaxIdr,480n);
  assert.equal(x.fxLossIdr,727n);
  assert.equal(x.refundAndChargebackReserveIdr,1817n);
  assert.equal(x.totalCostsIdr,14_502n);
  assert.equal(x.contributionIdr,21_836n);
  assert.equal(x.passesScenarioGate,true);
  assert.match(x.warning,/not net profit/i);
});
test("Pro QRIS same assumptions, no false net profit claim",()=>{
  const x=assessCandidateMargin({...base,grossIdr:127_638,gatewayFeeIdr:894,providerAllowanceIdr:27_390});
  assert.equal(x.gatewayFeeTaxIdr,108n);
  assert.equal(x.fxLossIdr,2553n);
  assert.equal(x.refundAndChargebackReserveIdr,6382n);
  assert.equal(x.contributionIdr,88311n);
  assert.equal(x.passesScenarioGate,true);
});
test("tiny bank VA top-up is rejected by offline margin gate",()=>{
  const x=assessCandidateMargin({...base,grossIdr:5000,providerAllowanceIdr:2000,otherVariableCostsIdr:300});
  assert.equal(x.passesScenarioGate,false);
  assert.ok(x.contributionIdr<0n);
});
test("provider cost overrun exposes unprofitable credit allocation",()=>{
  const x=assessCandidateMargin({...base,providerAllowanceIdr:20000,providerOverrunBps:10000});
  assert.equal(x.stressedProviderCostIdr,40000n);
  assert.equal(x.passesScenarioGate,false);
  assert.ok(x.contributionIdr<0n);
});
test("never silently assume missing merchant fees and stress factors are zero",()=>{
  assert.throws(()=>assessCandidateMargin({grossIdr:100}),/nonnegative safe integer/);
  assert.throws(()=>assessCandidateMargin({...base,grossIdr:0}),/grossIdr must be positive/);
  assert.throws(()=>assessCandidateMargin({...base,gatewayFeeIdr:-1}),/nonnegative safe integer/);
  assert.throws(()=>assessCandidateMargin({...base,fxLeakageBps:12000}),/basis points/);
  assert.throws(()=>assessCandidateMargin({...base,requiredContributionBps:10001}),/basis points/);
  assert.throws(()=>assessCandidateMargin({...base,providerOverrunBps:1.5}),/nonnegative safe integer/);
  assert.throws(()=>assessCandidateMargin({...base,refundAndChargebackReserveBps:undefined}),/nonnegative safe integer/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_POLICY,
  CREDIT_POLICY_STATUS,
  modelCostMicroUsd,
  tavilySearchCostMicroUsd,
  meteredSpendToCredits,
  quoteRequest,
  illustrativeMidtransFeeIdr,
  estimatePlanCeiling
} from "../evaluation/bor-ai-credit-scenarios.js";

test("credit cost model is proposal only and uses exact provider-published rates",()=>{
  assert.equal(CREDIT_POLICY_STATUS,"proposal-only-not-live");
  assert.equal(CREDIT_POLICY.cloudflareInputRatePerMillionMicroUsd,293000n);
  assert.equal(CREDIT_POLICY.cloudflareOutputRatePerMillionMicroUsd,2253000n);
  assert.equal(CREDIT_POLICY.microUsdPerCredit,100n);
  assert.equal(CREDIT_POLICY.plans.basic.proposedCredits,3000n);
  assert.equal(CREDIT_POLICY.plans.pro.proposedCredits,15000n);
});

test("actual token counts determine call cost and single-request credits, not message count",()=>{
  const cost=modelCostMicroUsd({inputTokens:2000,outputTokens:500});
  assert.equal(cost,1713n); // $0.0017125 rounded up to a micro-USD
  assert.equal(meteredSpendToCredits(cost),18n); // proposed one credit = $0.0001
  assert.equal(modelCostMicroUsd({inputTokens:0,outputTokens:0}),0n);
  assert.equal(meteredSpendToCredits(0n),0n);
});

test("multi-agent bills for all separate model calls plus enabled Tavily API credits",()=>{
  assert.equal(tavilySearchCostMicroUsd({apiCredits:1}),8000n);
  const sample=quoteRequest({
    modelCalls:[{inputTokens:2000,outputTokens:500},{inputTokens:2000,outputTokens:500}],
    tavilyApiCredits:1
  });
  assert.equal(sample.modelSpendMicroUsd,3426n);
  assert.equal(sample.searchSpendMicroUsd,8000n);
  assert.equal(sample.totalMicroUsd,11426n);
  assert.equal(sample.proposedCustomerCredits,115n);
});

test("reference FX and Midtrans fees are modeled as illustrative, not profit",()=>{
  const basicVA=estimatePlanCeiling({plan:"basic",fxIdrPerUsd:18260,method:"bank_va"});
  assert.equal(basicVA.grossIdr,36338n);
  assert.equal(basicVA.feeIdr,4000n);
  assert.equal(basicVA.providerAllowanceIdr,5478n);
  assert.equal(basicVA.remainingBeforeOtherCostsIdr,26860n);

  const proQRIS=estimatePlanCeiling({plan:"pro",fxIdrPerUsd:18260,method:"qris"});
  assert.equal(proQRIS.grossIdr,127638n);
  assert.equal(proQRIS.feeIdr,894n);
  assert.equal(proQRIS.providerAllowanceIdr,27390n);
  assert.equal(proQRIS.remainingBeforeOtherCostsIdr,99354n);

  assert.equal(illustrativeMidtransFeeIdr({amountIdr:36338,method:"gopay"}),727n);
  assert.match(proQRIS.warning,/Not profit/i);
});

test("invalid token counts, fees, currency, methods and unknown tiers fail closed",()=>{
  assert.throws(()=>modelCostMicroUsd({inputTokens:-1,outputTokens:1}),/nonnegative safe integer/);
  assert.throws(()=>modelCostMicroUsd({inputTokens:10.5,outputTokens:1}),/nonnegative safe integer/);
  assert.throws(()=>quoteRequest({modelCalls:"not an array"}),/array/);
  assert.throws(()=>quoteRequest({modelCalls:[],tavilyApiCredits:-1}),/nonnegative safe integer/);
  assert.throws(()=>meteredSpendToCredits(-1n),/nonnegative bigint/);
  assert.throws(()=>illustrativeMidtransFeeIdr({amountIdr:10000,method:"unknown"}),/explicit verified tariff/);
  assert.throws(()=>estimatePlanCeiling({plan:"free",fxIdrPerUsd:18260,method:"qris"}),/Unknown plan/);
  assert.throws(()=>estimatePlanCeiling({plan:"basic",fxIdrPerUsd:0,method:"qris"}),/positive integer/);
});

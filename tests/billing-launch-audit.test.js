import test from 'node:test';
import assert from 'node:assert/strict';
import {BILLING_RELEASE_GATES,assessBillingRelease,auditBillingEconomics} from '../src/billing-launch-audit.js';

const assumptions=Object.freeze({
  sku:'basic',credits:3000,fxIdrPerUsd:'18000.25',
  fxSource:'ILLUSTRATIVE staging FX only, not a verified live USD/IDR rate',
  gatewayMethod:'BCA_VA',gatewayFixedFeeIdr:5000,gatewayPercentBps:0,
  gatewayFeesIncludeTax:true,
  aiModel:'gpt-5.4-mini',
  aiInputUsdPerMillion:'0.75',aiOutputUsdPerMillion:'4.50',
  aiRateSource:'https://developers.openai.com/api/docs/models/gpt-5.4-mini (19 Nov 2026)',
  requests:30,inputTokensPerRequest:2000,outputTokensPerRequest:800,
  tavilyBasicSearches:5,tavilyAdvancedSearches:0,tavilyUsdPerCredit:'0.008',
  tavilyRateSource:'https://www.tavily.com/pricing (19 Nov 2026)',
  creditFaceMicroUsd:100,fxReserveIdr:500,refundReserveIdr:700,
  otherVariableCostIdr:1000,minimumContributionBps:2000
});
test('production readiness always fails closed, even when caller asserts every checklist item',()=>{
  const first=assessBillingRelease();
  assert.equal(first.status,'NO_GO');
  assert.equal(first.productionCheckoutEnabled,false);
  assert.equal(first.unresolved.length,BILLING_RELEASE_GATES.length);
  const reported=assessBillingRelease(Object.fromEntries(BILLING_RELEASE_GATES.map(k=>[k,true])));
  assert.equal(reported.reviewedGates,BILLING_RELEASE_GATES.length);
  assert.equal(reported.status,'NO_GO');
  assert.equal(reported.productionActivationImplemented,false);
  assert.equal(reported.productionCheckoutEnabled,false);
  assert.throws(()=>assessBillingRelease({duitkuMerchantApproved:'yes'}));
  assert.throws(()=>assessBillingRelease({allowAllPayments:true}));
});
test('proposed Basic economics include VAT-inclusive fee once, model tokens, Tavily and reserves',()=>{
  const result=auditBillingEconomics(assumptions);
  assert.equal(result.priceUsd,'1.99');
  assert.equal(result.quotedIdr,'35821');
  assert.equal(result.gatewayFeeIdr,'5000');
  assert.equal(result.providerBudgetUsdMicro,'300000');
  assert.equal(result.modeledAiCostUsdMicro,'153000');
  assert.equal(result.modeledTavilyCostUsdMicro,'40000');
  assert.equal(result.modeledProviderCostUsdMicro,'193000');
  assert.equal(result.creditsNeeded,'1930');
  assert.equal(result.creditsWithinBudget,true);
  assert.equal(result.contributionIdr,'23620');
  assert.equal(result.marginScreenPasses,true);
  assert.equal(result.scenarioSafe,true);
  assert.equal(result.liveCheckoutEnabled,false);
});
test('QRIS public 0.7% fee rounds up once; never add duplicate PPN',()=>{
  const qr=auditBillingEconomics({...assumptions,gatewayMethod:'QRIS',
    gatewayFixedFeeIdr:0,gatewayPercentBps:70});
  assert.equal(qr.quotedIdr,'35821');
  assert.equal(qr.gatewayFeeIdr,'251');
  assert.equal(qr.creditsNeeded,'1930');
  assert.equal(qr.liveCheckoutEnabled,false);
});
test('high usage + advanced Tavily must fail credit and margin screen, not assume unlimited access',()=>{
  const stressed=auditBillingEconomics({...assumptions,
    requests:100,inputTokensPerRequest:4000,outputTokensPerRequest:2500,
    tavilyBasicSearches:0,tavilyAdvancedSearches:20});
  assert.equal(stressed.creditsWithinBudget,false);
  assert.equal(stressed.creditsNeeded,'17450');
  assert.equal(stressed.marginScreenPasses,false);
  assert.equal(stressed.scenarioSafe,false);
  assert.ok(BigInt(stressed.contributionIdr)<BigInt(stressed.minimumContributionIdr));
});
test('Pro plan has higher credit budget, but expensive usage can still exceed it',()=>{
  const pro=auditBillingEconomics({...assumptions,sku:'pro',credits:15000,
    requests:100,tavilyBasicSearches:20});
  assert.equal(pro.priceUsd,'6.99');
  assert.equal(pro.quotedIdr,'125822');
  assert.equal(pro.providerBudgetUsdMicro,'1500000');
  assert.equal(pro.creditsNeeded,'6700');
  assert.equal(pro.scenarioSafe,true);
  const bad=auditBillingEconomics({...assumptions,sku:'pro',credits:15000,
    requests:400,inputTokensPerRequest:4000,outputTokensPerRequest:2500,
    tavilyBasicSearches:0,tavilyAdvancedSearches:20});
  assert.equal(bad.creditsNeeded,'60200');
  assert.equal(bad.scenarioSafe,false);
});
test('unverified or missing rate components, arbitrary currencies and unsafe numerics fail closed',()=>{
  const bad=[
    {gatewayFeesIncludeTax:false},{gatewayFeesIncludeTax:undefined},
    {aiInputUsdPerMillion:'0'},{aiInputUsdPerMillion:undefined},
    {aiOutputUsdPerMillion:'0'}, {tavilyUsdPerCredit:undefined},
    {tavilyUsdPerCredit:'0'},{fxIdrPerUsd:'0'},
    {creditFaceMicroUsd:0},{credits:0},{credits:0.1},
    {gatewayFixedFeeIdr:-1},{gatewayFixedFeeIdr:NaN},
    {gatewayPercentBps:10001},{gatewayPercentBps:0.25},
    {inputTokensPerRequest:1.1},{requests:-1},
    {fxSource:''},{aiRateSource:''},
    {sku:'topup'},{minimumContributionBps:10001}
  ];
  for(const overrides of bad){
    assert.throws(()=>auditBillingEconomics({...assumptions,...overrides}),undefined,JSON.stringify(overrides));
  }
});
test('source snapshots never treat modeled cost as authorization for real payment',()=>{
  const safe=auditBillingEconomics(assumptions);
  for(const key of ['merchantCode','apiKey','callbackSecret','paymentUrl','walletId']){
    assert.equal(Object.hasOwn(safe,key),false);
  }
  assert.equal(safe.status,'SCENARIO_ONLY_NOT_PRODUCTION_PRICE');
  assert.equal(safe.realCreditsGranted,false);
});

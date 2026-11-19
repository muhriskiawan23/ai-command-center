import test from 'node:test';
import assert from 'node:assert/strict';
import {BOR_BILLING_STATUS,BOR_PLAN_PRICES,previewBillingQuote} from '../src/billing-quote-core.js';
const base=Object.freeze({
  sku:'basic',proposedCredits:3000,proposedTariffVersion:'DRAFT-2026-11-19',
  fxIdrPerUsd:'18000.25',fxSource:'illustrative-not-a-live-rate',
  issuedAtMs:1800000000000,expiresAtMs:1800000600000,
  gatewayMethod:'BT',gatewayFeeIdr:4000,gatewayFeeSource:'illustrative-unverified-fee',
  gatewayFeeTaxIdr:480,providerBudgetUsd:'0.30',fxReserveIdr:500,
  refundReserveIdr:700,otherVariableCostsIdr:1000,minimumContributionBps:2000
});
test('approved-facing USD prices stay fixed and IDR preview rounds up exactly',()=>{
  assert.equal(BOR_PLAN_PRICES.basic.priceUsd,'1.99');
  assert.equal(BOR_PLAN_PRICES.pro.priceUsd,'6.99');
  const basic=previewBillingQuote(base);
  const pro=previewBillingQuote({...base,sku:'pro',proposedCredits:15000,providerBudgetUsd:'1.50'});
  assert.equal(basic.lockedIdrPreview,'35821');
  assert.equal(pro.lockedIdrPreview,'125822');
  assert.equal(basic.providerBudgetIdr,'5401');
  assert.equal(basic.status,BOR_BILLING_STATUS);
  assert.equal(basic.checkoutEnabled,false);
  assert.equal(basic.launchEligible,false);
  assert.equal(basic.realCreditsGranted,false);
  assert.equal(basic.passesMarginScreen,true);
});
test('top-up with fee above gross must fail the contribution margin screen',()=>{
  const quote=previewBillingQuote({...base,sku:'topup',topupPriceUsd:'0.10',
    proposedCredits:100,providerBudgetUsd:'0.02'});
  assert.equal(quote.lockedIdrPreview,'1801');
  assert.equal(quote.passesMarginScreen,false);
  assert.ok(BigInt(quote.contributionIdr)<0n);
  assert.equal(quote.launchEligible,false);
});
test('missing fees, rate metadata, credit tariff or stale expiry fail closed',()=>{
  const changes=[
    {gatewayFeeIdr:undefined},{gatewayFeeSource:''},{gatewayFeeTaxIdr:undefined},
    {fxReserveIdr:undefined},{refundReserveIdr:undefined},{otherVariableCostsIdr:undefined},
    {providerBudgetUsd:undefined},{fxSource:''},{minimumContributionBps:undefined},
    {proposedCredits:-1},{proposedTariffVersion:''},
    {expiresAtMs:base.issuedAtMs+16*60000},{expiresAtMs:base.issuedAtMs-1},
    {fxIdrPerUsd:'0'},{gatewayFeeIdr:-1},{gatewayFeeIdr:0.1},
    {sku:'unknown'},{topupPriceUsd:'4.99'}
  ];
  for(const change of changes) assert.throws(()=>previewBillingQuote({...base,...change}),undefined,JSON.stringify(change));
  assert.throws(()=>previewBillingQuote({...base,sku:'topup'}),/topup price/);
});
test('offline quote contains no payment URL, signed token or balance grant',()=>{
  const q=previewBillingQuote(base);
  assert.equal(q.proposedCredits,'3000');
  assert.equal(Object.hasOwn(q,'paymentUrl'),false);
  assert.equal(Object.hasOwn(q,'walletId'),false);
  assert.equal(q.realCreditsGranted,false);
});

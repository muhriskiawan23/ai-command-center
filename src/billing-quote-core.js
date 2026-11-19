// Pure, OFFLINE BOR AI billing quote preview. Never accepts payments or grants real credits.
import { parseUsdMicro } from './credit-metering.js';
export const BOR_BILLING_STATUS = 'proposal_only_no_live_checkout_or_grants';
export const BOR_PLAN_PRICES = Object.freeze({
  basic: Object.freeze({priceUsd:'1.99',period:'monthly'}),
  pro: Object.freeze({priceUsd:'6.99',period:'monthly'})
});
const MILLION = 1_000_000n, FX_DIVISOR = MILLION*MILLION;
const ceilDiv=(a,b)=>(a+b-1n)/b;
function whole(v,name) {
  if(!Number.isSafeInteger(v)||v<0)throw new TypeError(name+' must be nonnegative safe integer');
  return BigInt(v);
}
function named(v,name) {
  if(typeof v!=='string'||!v.trim()||v.length>128)throw new TypeError(name+' must be nonempty bounded string');
  return v.trim();
}
function idrForUsd(microUsd,rateMicroIdrPerUsd){return ceilDiv(microUsd*rateMicroIdrPerUsd,FX_DIVISOR)}
// Server-provided assumptions, NEVER customer-controlled and never a live or persisted FX lock.
export function previewBillingQuote({
  sku,topupPriceUsd,proposedCredits,proposedTariffVersion,
  fxIdrPerUsd,fxSource,issuedAtMs,expiresAtMs,
  gatewayMethod,gatewayFeeIdr,gatewayFeeSource,gatewayFeeTaxIdr,
  providerBudgetUsd,fxReserveIdr,refundReserveIdr,otherVariableCostsIdr,
  minimumContributionBps
}){
  named(sku,'sku');
  const plan=BOR_PLAN_PRICES[sku];
  if(!plan&&sku!=='topup')throw new TypeError('unknown sku');
  if(plan&&topupPriceUsd!==undefined)throw new TypeError('plan price is fixed in USD');
  if(!plan&&typeof topupPriceUsd!=='string')throw new TypeError('topup price requires an explicitly configured USD string');
  const priceUsd=plan?plan.priceUsd:topupPriceUsd;
  const priceMicroUsd=parseUsdMicro(priceUsd);
  if(priceMicroUsd<=0n)throw new TypeError('price must be positive');
  const credits=whole(proposedCredits,'proposedCredits');
  if(credits===0n)throw new TypeError('proposedCredits must be positive');
  const tariffVersion=named(proposedTariffVersion,'proposedTariffVersion');
  const rateMicroIdrPerUsd=parseUsdMicro(fxIdrPerUsd);
  if(rateMicroIdrPerUsd<=0n)throw new TypeError('fx rate must be positive');
  const source=named(fxSource,'fxSource');
  const method=named(gatewayMethod,'gatewayMethod');
  const feeSource=named(gatewayFeeSource,'gatewayFeeSource');
  if(!Number.isSafeInteger(issuedAtMs)||!Number.isSafeInteger(expiresAtMs)||
     issuedAtMs<0||expiresAtMs<=issuedAtMs||expiresAtMs-issuedAtMs>15*60*1000)
     throw new TypeError('quote validity must be positive and at most 15 minutes');
  const fee=whole(gatewayFeeIdr,'gatewayFeeIdr');
  const feeTax=whole(gatewayFeeTaxIdr,'gatewayFeeTaxIdr');
  const fxReserve=whole(fxReserveIdr,'fxReserveIdr');
  const refundReserve=whole(refundReserveIdr,'refundReserveIdr');
  const otherCosts=whole(otherVariableCostsIdr,'otherVariableCostsIdr');
  const minBps=whole(minimumContributionBps,'minimumContributionBps');
  if(minBps>10000n)throw new TypeError('minimumContributionBps out of range');
  const budgetMicroUsd=parseUsdMicro(providerBudgetUsd);
  const grossIdr=idrForUsd(priceMicroUsd,rateMicroIdrPerUsd);
  const providerBudgetIdr=idrForUsd(budgetMicroUsd,rateMicroIdrPerUsd);
  const contributionIdr=grossIdr-fee-feeTax-fxReserve-refundReserve-otherCosts-providerBudgetIdr;
  const requiredContributionIdr=ceilDiv(grossIdr*minBps,10000n);
  return Object.freeze({
    status:BOR_BILLING_STATUS,checkoutEnabled:false,realCreditsGranted:false,launchEligible:false,
    sku,priceUsd,proposedCredits:credits.toString(),proposedTariffVersion:tariffVersion,
    gatewayMethod:method,gatewayFeeSource:feeSource,fxIdrPerUsd,fxSource:source,issuedAtMs,expiresAtMs,
    lockedIdrPreview:grossIdr.toString(),providerBudgetIdr:providerBudgetIdr.toString(),
    gatewayFeeIdr:fee.toString(),gatewayFeeTaxIdr:feeTax.toString(),
    fxReserveIdr:fxReserve.toString(),refundReserveIdr:refundReserve.toString(),
    otherVariableCostsIdr:otherCosts.toString(),
    contributionIdr:contributionIdr.toString(),requiredContributionIdr:requiredContributionIdr.toString(),
    passesMarginScreen:contributionIdr>=requiredContributionIdr,
    warning:'Planning quote only. No persisted FX lock, live credit grants or production payments.'
  });
}

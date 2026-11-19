// OFFLINE financial and readiness audit ONLY. Not imported by production Workers,
// staging checkout or any authenticated route. Never activates payments/credits.
// Money arithmetic is exact BigInt with micro-USD and integer IDR. Rates require
// an explicitly identified, dated source before they can be approved for launch.
import {parseUsdMicro,calculateProviderCostMicroUsd} from './credit-metering.js';
import {BOR_PLAN_PRICES} from './billing-quote-core.js';

const MILLION=1_000_000n;
const FX_DENOM=MILLION*MILLION;
const ceilDiv=(n,d)=>(n+d-1n)/d;
const amount=v=>typeof v==='string'?parseUsdMicro(v):(()=>{throw new TypeError('monetary amounts must be decimal USD strings')})();
const whole=(v,name)=>{
  if(!Number.isSafeInteger(v)||v<0)throw new TypeError(name+' must be a nonnegative safe integer');
  return BigInt(v);
};
const textRequired=(v,name)=>{
  if(typeof v!=='string'||!v.trim()||v.length>256)throw new TypeError(name+' must identify a bounded source');
  return v;
};
const positive=(v,name)=>{
  const n=amount(v);
  if(n<=0n)throw new TypeError(name+' must be positive, not an unknown cost treated as free');
  return n;
};
const idrForUsd=(microUsd,fxMicro)=>ceilDiv(microUsd*fxMicro,FX_DENOM);
const greater=(a,b)=>a>b?a:b;

// Gate labels are immutable. Passing a theoretical gate is never authorization
// to turn on production billing. A separate reviewed launch implementation is
// required, as today no live entitlement or refund adapter exists.
export const BILLING_RELEASE_GATES=Object.freeze([
  'duitkuMerchantApproved',
  'productionPaymentChannelsApproved',
  'dedicatedLiveSecretsProvisioned',
  'liveCallbackSignatureAndFirstPaymentVerified',
  'providerStatusReconciliationReviewed',
  'idempotentSettlementAndCreditMeteringVerified',
  'refundMoneyMovementSopAndEvidenceApproved',
  'chargebackAndDebtRecoverySopApproved',
  'publishedRefundAndBillingTermsReviewed',
  'merchantFeeContractAndTaxTreatmentConfirmed',
  'usdIdrFxSourceAndCheckoutLockValidated',
  'actualAiAndToolRateCardsConfirmed',
  'creditsPerModelToolCostGuardEnforced',
  'rolloverAndTopupLiabilityPolicyApproved',
  'fraudRateLimitsAndOperationalAlertsTested',
  'productionCanaryAndRollbackPlanApproved'
]);
export function assessBillingRelease(evidence={}){
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))
    throw new TypeError('named review evidence required');
  const unknown=Object.keys(evidence).filter(k=>!BILLING_RELEASE_GATES.includes(k));
  if(unknown.length)throw new TypeError('unknown release gate');
  for(const [key,value] of Object.entries(evidence)){
    if(typeof value!=='boolean')throw new TypeError('gate '+key+' must be boolean');
  }
  const pending=BILLING_RELEASE_GATES.filter(key=>evidence[key]!==true);
  return Object.freeze({
    status:'NO_GO',
    // This diagnostic cannot create an entitlement, set an environment flag,
    // configure live gateway endpoints or approve an actual deployment.
    productionCheckoutEnabled:false,
    productionActivationImplemented:false,
    reviewedGates:BILLING_RELEASE_GATES.length-pending.length,
    totalGates:BILLING_RELEASE_GATES.length,
    unresolved:pending,
    blocker:'NO LIVE PAYMENT OR PRODUCTION CREDIT GRANT IMPLEMENTATION IS REVIEWED'
  });
}

// Rates are explicit scenario inputs, NOT trusted production price configuration.
// Gross is frozen USD list price translated at illustrative FX; fees are assumed
// to be paid by merchant. Gateway public prices include VAT: no second VAT add.
export function auditBillingEconomics({
  sku, credits, fxIdrPerUsd, fxSource,
  gatewayMethod, gatewayFixedFeeIdr, gatewayPercentBps,
  gatewayFeesIncludeTax,
  aiModel, aiInputUsdPerMillion, aiOutputUsdPerMillion, aiRateSource,
  requests, inputTokensPerRequest, outputTokensPerRequest,
  tavilyBasicSearches, tavilyAdvancedSearches, tavilyUsdPerCredit, tavilyRateSource,
  creditFaceMicroUsd=100,
  fxReserveIdr,refundReserveIdr,otherVariableCostIdr,
  minimumContributionBps=2000
}){
  const plan=BOR_PLAN_PRICES[sku];
  if(!plan)throw new TypeError('supported monthly plan required');
  textRequired(fxSource,'fxSource');
  textRequired(gatewayMethod,'gatewayMethod');
  textRequired(aiModel,'aiModel');
  textRequired(aiRateSource,'aiRateSource');
  textRequired(tavilyRateSource,'tavilyRateSource');
  if(gatewayFeesIncludeTax!==true)
    throw new TypeError('gateway fee tax inclusion must be explicitly confirmed to avoid double counting');
  const quantity=whole(credits,'credits');
  const unitCost=whole(creditFaceMicroUsd,'creditFaceMicroUsd');
  if(quantity===0n||unitCost===0n)throw new TypeError('credits and budget per credit must be positive');
  const fx=positive(fxIdrPerUsd,'fx');
  const aiInput=positive(aiInputUsdPerMillion,'AI input rate');
  const aiOutput=positive(aiOutputUsdPerMillion,'AI output rate');
  const toolRate=positive(tavilyUsdPerCredit,'Tavily credit rate');
  const nRequests=whole(requests,'requests');
  const inTokens=whole(inputTokensPerRequest,'inputTokensPerRequest');
  const outTokens=whole(outputTokensPerRequest,'outputTokensPerRequest');
  const basic=whole(tavilyBasicSearches,'tavilyBasicSearches');
  const advanced=whole(tavilyAdvancedSearches,'tavilyAdvancedSearches');
  const fixed=whole(gatewayFixedFeeIdr,'gatewayFixedFeeIdr');
  const percent=whole(gatewayPercentBps,'gatewayPercentBps');
  if(percent>10000n)throw new TypeError('gatewayPercentBps out of range');
  const reserveFx=whole(fxReserveIdr,'fxReserveIdr');
  const reserveRefund=whole(refundReserveIdr,'refundReserveIdr');
  const other=whole(otherVariableCostIdr,'otherVariableCostIdr');
  const bps=whole(minimumContributionBps,'minimumContributionBps');
  if(bps>10000n)throw new TypeError('minimumContributionBps out of range');
  const gross=idrForUsd(amount(plan.priceUsd),fx);
  const gatewayFee=fixed+ceilDiv(gross*percent,10000n);
  // Bill by vendor measured token usage, not requests; reserve for tool calls.
  const modelCostPerRequest=calculateProviderCostMicroUsd({
    inputTokens:Number(inTokens),outputTokens:Number(outTokens),
    inputRateMicroUsdPerMillion:aiInput,
    outputRateMicroUsdPerMillion:aiOutput
  });
  const modelCost=modelCostPerRequest*nRequests;
  const toolCredits=basic+advanced*2n;
  const toolCost=toolCredits*toolRate;
  const simulatedUsd=modelCost+toolCost;
  const budgetUsd=quantity*unitCost;
  const creditsNeeded=ceilDiv(simulatedUsd,unitCost);
  const worstProviderCost=greater(simulatedUsd,budgetUsd);
  const costIdr=idrForUsd(worstProviderCost,fx);
  const contribution=gross-gatewayFee-reserveFx-reserveRefund-other-costIdr;
  const minimum=ceilDiv(gross*bps,10000n);
  const withinCredits=creditsNeeded<=quantity;
  return Object.freeze({
    status:'SCENARIO_ONLY_NOT_PRODUCTION_PRICE',
    liveCheckoutEnabled:false,realCreditsGranted:false,
    sku,priceUsd:plan.priceUsd,credits:quantity.toString(),
    providerBudgetUsdMicro:budgetUsd.toString(),
    aiModel,aiRateSource,tavilyRateSource,fxSource,gatewayMethod,
    quotedIdr:gross.toString(),gatewayFeeIdr:gatewayFee.toString(),
    totalReservesAndOtherIdr:(reserveFx+reserveRefund+other).toString(),
    modeledProviderCostUsdMicro:simulatedUsd.toString(),
    modeledAiCostUsdMicro:modelCost.toString(),
    modeledTavilyCostUsdMicro:toolCost.toString(),
    creditsNeeded:creditsNeeded.toString(),
    creditsWithinBudget:withinCredits,
    conservativeProviderIdr:costIdr.toString(),
    contributionIdr:contribution.toString(),
    minimumContributionIdr:minimum.toString(),
    marginScreenPasses:contribution>=minimum,
    scenarioSafe:withinCredits&&contribution>=minimum,
    warning:'Scenario only; simulated traffic, fees/FX and tool subscription do not authorize live payments.'
  });
}

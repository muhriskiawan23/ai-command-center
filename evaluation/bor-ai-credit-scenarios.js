/**
 * Offline, testable COST HYPOTHESIS for BOR AI. No network, secrets, paid API calls
 * or integration into chat, checkout, quotas, payment or the credit ledger.
 *
 * Verified publicly advertised rates as of 2026-11-17:
 * Cloudflare @cf/meta/llama-3.3-70b-instruct-fp8-fast:
 *   $0.293 / M input tokens, $2.253 / M output tokens
 * https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
 * Tavily pay-as-you-go: $0.008 per API credit
 * https://www.tavily.com/pricing
 * Midtrans advertised bank VA IDR 4,000, QRIS 0.7%, GoPay 2%.
 * Actual agreement, VAT, gaming/digital-product classification and
 * per-merchant discounts or surcharges may differ.
 * https://midtrans.com/id/biaya
 */
const MICRO_USD_PER_USD = 1_000_000n;
const MICRO_USD_PER_BOR_CREDIT = 100n; // proposed customer accounting unit: $0.0001
const ONE_MILLION_TOKENS = 1_000_000n;
const CF_INPUT_MICRO_USD_PER_M = 293_000n;
const CF_OUTPUT_MICRO_USD_PER_M = 2_253_000n;
const TAVILY_API_CREDIT_MICRO_USD = 8_000n;
const PLANS = Object.freeze({
  basic: Object.freeze({ usdCents: 199n, proposedCredits: 3_000n }),
  pro: Object.freeze({ usdCents: 699n, proposedCredits: 15_000n })
});
export const CREDIT_POLICY_STATUS = "proposal-only-not-live";
export const CREDIT_POLICY = Object.freeze({
  microUsdPerCredit: MICRO_USD_PER_BOR_CREDIT,
  cloudflareInputRatePerMillionMicroUsd: CF_INPUT_MICRO_USD_PER_M,
  cloudflareOutputRatePerMillionMicroUsd: CF_OUTPUT_MICRO_USD_PER_M,
  tavilyPaygoMicroUsdPerApiCredit: TAVILY_API_CREDIT_MICRO_USD,
  plans: PLANS
});
const ceilDiv = (a,b) => (a+b-1n)/b;
function safeWhole(number,label){
  if(!Number.isSafeInteger(number)||number<0)throw new TypeError(label+" must be a nonnegative safe integer");
  return BigInt(number);
}
function positiveIdrRate(rate){
  if(!Number.isSafeInteger(rate)||rate<=0)throw new TypeError("fxIdrPerUsd must be a positive integer reference rate");
  return BigInt(rate);
}
export function modelCostMicroUsd({inputTokens,outputTokens}){
  const input=safeWhole(inputTokens,"inputTokens");
  const output=safeWhole(outputTokens,"outputTokens");
  return ceilDiv(input*CF_INPUT_MICRO_USD_PER_M+output*CF_OUTPUT_MICRO_USD_PER_M,ONE_MILLION_TOKENS);
}
export function tavilySearchCostMicroUsd({apiCredits}){
  // Search can consume >1 API credit. Do not assume Extract or other APIs have the same tariff.
  return safeWhole(apiCredits,"apiCredits")*TAVILY_API_CREDIT_MICRO_USD;
}
export function meteredSpendToCredits(microUsd){
  if(typeof microUsd!=="bigint"||microUsd<0n)throw new TypeError("cost must be a nonnegative bigint");
  return ceilDiv(microUsd,MICRO_USD_PER_BOR_CREDIT);
}
export function quoteRequest({modelCalls=[],tavilyApiCredits=0}){
  if(!Array.isArray(modelCalls))throw new TypeError("modelCalls must be an array");
  const modelSpendMicroUsd=modelCalls.reduce((sum,call)=>sum+modelCostMicroUsd(call),0n);
  const searchSpendMicroUsd=tavilySearchCostMicroUsd({apiCredits:tavilyApiCredits});
  const totalMicroUsd=modelSpendMicroUsd+searchSpendMicroUsd;
  return {modelSpendMicroUsd,searchSpendMicroUsd,totalMicroUsd,proposedCustomerCredits:meteredSpendToCredits(totalMicroUsd)};
}
export function illustrativeMidtransFeeIdr({amountIdr,method}){
  const amount=safeWhole(amountIdr,"amountIdr");
  if(method==="bank_va")return 4_000n;
  if(method==="qris")return ceilDiv(amount*7n,1_000n);
  if(method==="gopay")return ceilDiv(amount*2n,100n);
  throw new TypeError("Method needs an explicit verified tariff");
}
export function estimatePlanCeiling({plan,fxIdrPerUsd,method}){
  const chosen=PLANS[plan];
  if(!chosen)throw new TypeError("Unknown plan; Free has no paid-credit allowance");
  const rate=positiveIdrRate(fxIdrPerUsd);
  const grossIdr=ceilDiv(chosen.usdCents*rate,100n);
  if(grossIdr>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError("gross exceeds safe integer");
  const providerAllowanceMicroUsd=chosen.proposedCredits*MICRO_USD_PER_BOR_CREDIT;
  const providerAllowanceIdr=ceilDiv(providerAllowanceMicroUsd*rate,MICRO_USD_PER_USD);
  const feeIdr=illustrativeMidtransFeeIdr({amountIdr:Number(grossIdr),method});
  return Object.freeze({
    plan, method, fxIdrPerUsd:rate, grossIdr, feeIdr,
    proposedCredits:chosen.proposedCredits, providerAllowanceMicroUsd, providerAllowanceIdr,
    remainingBeforeOtherCostsIdr:grossIdr-feeIdr-providerAllowanceIdr,
    warning:"Not profit: FX spread, indirect fees, VAT/tax, chargebacks, infrastructure, refunds, support and provider overruns excluded"
  });
}

/**
 * BOR AI offline contribution stress model — NEVER live billing, NEVER a fee quote.
 * All inputs required: safe integer IDR and basis points (10,000 = 100%).
 * Supply merchant-specific fees and verified provider costs before interpreting results.
 */
const BPS=10_000n;
const ceilDiv=(a,b)=>(a+b-1n)/b;
function whole(n,label){
  if(!Number.isSafeInteger(n)||n<0)throw new TypeError(label+" must be a nonnegative safe integer");
  return BigInt(n);
}
function percent(n,label){
  const v=whole(n,label);
  if(v>BPS)throw new RangeError(label+" must be <= 10000 basis points");
  return v;
}
/** Calculate a fully parameterized illustration, not final profitability. */
export function assessCandidateMargin({
  grossIdr,gatewayFeeIdr,providerAllowanceIdr,gatewayFeeTaxBps,
  fxLeakageBps,refundAndChargebackReserveBps,providerOverrunBps,
  otherVariableCostsIdr,requiredContributionBps
}){
  const revenue=whole(grossIdr,"grossIdr");
  if(revenue===0n)throw new RangeError("grossIdr must be positive");
  const fee=whole(gatewayFeeIdr,"gatewayFeeIdr");
  const provider=whole(providerAllowanceIdr,"providerAllowanceIdr");
  const taxRate=percent(gatewayFeeTaxBps,"gatewayFeeTaxBps");
  const fxRate=percent(fxLeakageBps,"fxLeakageBps");
  const disputeRate=percent(refundAndChargebackReserveBps,"refundAndChargebackReserveBps");
  const overrunRate=percent(providerOverrunBps,"providerOverrunBps");
  const required=percent(requiredContributionBps,"requiredContributionBps");
  const other=whole(otherVariableCostsIdr,"otherVariableCostsIdr");
  // Round every component upward; no implicit zero fee/reserve/tax assumptions.
  const gatewayFeeTaxIdr=ceilDiv(fee*taxRate,BPS);
  const fxLossIdr=ceilDiv(revenue*fxRate,BPS);
  const refundAndChargebackReserveIdr=ceilDiv(revenue*disputeRate,BPS);
  const stressedProviderCostIdr=ceilDiv(provider*(BPS+overrunRate),BPS);
  const totalCostsIdr=fee+gatewayFeeTaxIdr+fxLossIdr+refundAndChargebackReserveIdr+stressedProviderCostIdr+other;
  const contributionIdr=revenue-totalCostsIdr;
  const contributionBps=contributionIdr*BPS/revenue;
  return Object.freeze({
    grossIdr:revenue,gatewayFeeIdr:fee,gatewayFeeTaxIdr,fxLossIdr,
    refundAndChargebackReserveIdr,stressedProviderCostIdr,
    otherVariableCostsIdr:other,totalCostsIdr,contributionIdr,
    contributionBps,requiredContributionBps:required,
    passesScenarioGate:contributionIdr>=0n&&contributionBps>=required,
    warning:"Illustration only: verify merchant tariffs, provider invoices, refund incidence and tax treatment; not net profit or authorization to charge."
  });
}

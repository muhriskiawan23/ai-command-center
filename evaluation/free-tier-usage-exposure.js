/**
 * Offline illustrative Free daily-unit cost model. Not actual billing,
 * not a provider spend ceiling, and not imported by production routes.
 */
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
function positive(n,name){
  if(!Number.isSafeInteger(n)||n<=0) throw new TypeError(name+" must be a positive safe integer");
  return n;
}
function micro(n,name){
  if(typeof n!=="bigint"||n<0n||n>MAX)
    throw new TypeError(name+" must be a non-negative safe bigint (micro-USD)");
  return n;
}
function safe(n,name){
  if(n>MAX)throw new RangeError(name+" exceeds the safe micro-USD range");
  return n;
}
/** Costliest fixed-cost mix under exactly a daily Free unit cap. */
export function costliestDailyMix({dailyUnits,multiAgentUnits,ordinaryMicroUsd,multiAgentMicroUsd}){
  const limit=positive(dailyUnits,"dailyUnits");
  const multiCharge=positive(multiAgentUnits,"multiAgentUnits");
  const ordinary=micro(ordinaryMicroUsd,"ordinaryMicroUsd");
  const multi=micro(multiAgentMicroUsd,"multiAgentMicroUsd");
  const fullMulti=Math.floor(limit/multiCharge);
  const allOrdinaryMicroUsd=BigInt(limit)*ordinary;
  const multiHeavyMicroUsd=BigInt(fullMulti)*multi+BigInt(limit%multiCharge)*ordinary;
  const chooseMulti=multiHeavyMicroUsd>allOrdinaryMicroUsd;
  const ordinaryCalls=chooseMulti?limit%multiCharge:limit;
  const multiAgentCalls=chooseMulti?fullMulti:0;
  const dailyMicroUsd=safe(chooseMulti?multiHeavyMicroUsd:allOrdinaryMicroUsd,"dailyMicroUsd");
  return Object.freeze({dailyUnits:limit,ordinaryCalls,multiAgentCalls,dailyMicroUsd});
}
/** Illustrative exposure per isolated user versus shared app cap; not all
 * users can simultaneously consume a shared global cap. Unit costs are
 * scenario inputs, not live token/metering evidence.
 */
export function assessFreeTierExposure({
  guestUnits,loggedInUnits,globalUnits,multiAgentUnits,
  ordinaryMicroUsd,multiAgentMicroUsd,periodDays,
  basicListPriceMicroUsd,proListPriceMicroUsd
}){
  const guest=positive(guestUnits,"guestUnits");
  const signed=positive(loggedInUnits,"loggedInUnits");
  const global=positive(globalUnits,"globalUnits");
  const days=positive(periodDays,"periodDays");
  if(days>366)throw new RangeError("periodDays must not exceed 366");
  const basic=micro(basicListPriceMicroUsd,"basicListPriceMicroUsd");
  const pro=micro(proListPriceMicroUsd,"proListPriceMicroUsd");
  if(basic===0n||pro===0n)throw new TypeError("Paid list prices must be positive");
  const input={multiAgentUnits,ordinaryMicroUsd,multiAgentMicroUsd};
  const guestDaily=costliestDailyMix({...input,dailyUnits:Math.min(guest,global)});
  const loggedInDaily=costliestDailyMix({...input,dailyUnits:Math.min(signed,global)});
  const globalDaily=costliestDailyMix({...input,dailyUnits:global});
  const period=(mix)=>safe(mix.dailyMicroUsd*BigInt(days),"periodMicroUsd");
  const guestPeriodMicroUsd=period(guestDaily);
  const loggedInPeriodMicroUsd=period(loggedInDaily);
  const globalPeriodMicroUsd=period(globalDaily);
  return Object.freeze({
    scenarioOnly:true,periodDays:days,guestDaily,loggedInDaily,globalDaily,
    guestPeriodMicroUsd,loggedInPeriodMicroUsd,globalPeriodMicroUsd,
    loggedInScenarioExceedsBasicListPrice:loggedInPeriodMicroUsd>basic,
    loggedInScenarioExceedsProListPrice:loggedInPeriodMicroUsd>pro,
    warning:"Hypothetical fixed-call costs, not live metering or spend caps. Actual token usage, model calls, provider billing, retries and free allowances are unverified."
  });
}

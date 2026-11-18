// INACTIVE Stage 3 staging-only orchestrator for synthetic integration tests.
// Not imported by production routes. Injected budget/ledger adapters must enforce
// atomic spend caps and customer-credit reservation in actual D1 independently.
// This module alone does not authorize paid inference, pricing or deployment.
import { calculateProviderCostMicroUsd } from "./credit-metering.js";
import { appendProviderUsageEvent, strictProviderTokenUsage } from "./provider-usage-journal.js";
import { authorizePlanFeature } from "./plan-entitlements.js";

const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const OPAQUE=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const PROVIDER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MODEL=/^[A-Za-z0-9@][A-Za-z0-9@/._:-]{0,179}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
function valid(value,re){return typeof value==="string" && re.test(value);}
function positive(value,name){
  if(typeof value!=="bigint" || value<=0n || value>MAX)
    throw new TypeError(name+" must be a positive safe bigint");
  return value;
}
function tokens(value,name) {
  if(!Number.isSafeInteger(value) || value<=0 || value>24000)
    throw new TypeError(name+" must be a positive bounded integer");
  return value;
}
function ceilDiv(a,b){return (a+b-1n)/b;}
function creditsForCost(cost,tariff) {
  if(cost<=0n || cost>MAX) throw new RangeError("Provider cost outside safe range");
  const credits=ceilDiv(cost*tariff.creditNumerator,tariff.creditDenominator);
  if(credits<=0n || credits>MAX) throw new RangeError("Customer credit cost outside safe range");
  return credits;
}
function checkedTariff(tariff){
  if(!tariff || tariff.approved!==true || !valid(tariff.version,VERSION) ||
    !valid(tariff.provider,PROVIDER) || !valid(tariff.model,MODEL))
    throw new TypeError("Server-approved, bounded tariff required");
  if(tariff.requiredPlan!==undefined &&
     !["basic","pro"].includes(tariff.requiredPlan))
    throw new TypeError("Server-approved minimum plan tier required");
  return {
    ...tariff,
    requiredPlan:tariff.requiredPlan??"basic",
    inputRateMicroUsdPerMillion:positive(tariff.inputRateMicroUsdPerMillion,"inputRate"),
    outputRateMicroUsdPerMillion:positive(tariff.outputRateMicroUsdPerMillion,"outputRate"),
    creditNumerator:positive(tariff.creditNumerator,"creditNumerator"),
    creditDenominator:positive(tariff.creditDenominator,"creditDenominator"),
    maxCallMicroUsd:positive(tariff.maxCallMicroUsd,"maxCallMicroUsd"),
    maxCallMicrocredits:positive(tariff.maxCallMicrocredits,"maxCallMicrocredits")
  };
}
function price(cost,tariff){return creditsForCost(cost,tariff);}
// The maximum quote must use trusted model context and explicit output limits.
// Callers MUST independently enforce these in the actual model provider call.
export function quoteJournaledInference({tariff,maxInputTokens,maxOutputTokens}){
  const policy=checkedTariff(tariff);
  const input=tokens(maxInputTokens,"maxInputTokens");
  const output=tokens(maxOutputTokens,"maxOutputTokens");
  const maximum=calculateProviderCostMicroUsd({
    inputTokens:input,outputTokens:output,
    inputRateMicroUsdPerMillion:policy.inputRateMicroUsdPerMillion,
    outputRateMicroUsdPerMillion:policy.outputRateMicroUsdPerMillion
  });
  const credit=price(maximum,policy);
  return maximum<=policy.maxCallMicroUsd && credit<=policy.maxCallMicrocredits
    ? {allowed:true,maximumMicroUsd:maximum,reservedMicrocredits:credit}
    : {allowed:false,reason:"call_spend_ceiling_exceeded"};
}
const declined=(reason,modelInvoked=false)=>({ok:false,reason,modelInvoked});
const callSafe=async(fn)=>{try{return await fn();}catch{return null;}};
// In production the request/attempt IDs must be generated and authenticated
// server-side. A new attempt MUST be created for every provider retry.
// DO NOT expose provider output unless both independent financial settlements
// succeed and the usage journal has acknowledged its durable measured event.
export async function runJournaledInferencePrototype({
  env,userId,requestId,attemptId,tariff,maxInputTokens,maxOutputTokens,
  providerBudget,ledger,invokeModel,journal=appendProviderUsageEvent
}){
  if(!env?.DB?.prepare || !valid(userId,OPAQUE) ||
    !valid(requestId,OPAQUE) || !valid(attemptId,OPAQUE) ||
    typeof invokeModel!=="function" || typeof journal!=="function" ||
    typeof providerBudget?.reserve!=="function" ||
    typeof providerBudget?.settle!=="function" ||
    typeof ledger?.reserve!=="function" || typeof ledger?.finalize!=="function")
    throw new TypeError("Server-authenticated IDs, D1, journal and two financial adapters required");
  const policy=checkedTariff(tariff);
  const quote=quoteJournaledInference({tariff:policy,maxInputTokens,maxOutputTokens});
  if(!quote.allowed) return declined(quote.reason);
  // In a future authorized Stage 3 environment, the account's actual paid
  // subscription tier must be verified BEFORE reserving provider spend or
  // dispatching inference. There is no client-selectable downgrade/upgrade.
  // The server-approved tariff determines the required Basic/Pro capability.
  // The prototype is inactive and never a production billing authorization.
  // Capture whether a verified plan was required at dispatch. A later
  // configuration change must NOT silently skip revocation checks.
  const paidPlanGate=env.PLAN_ENTITLEMENTS_ENABLED==="true";
  const feature=policy.requiredPlan==="pro"?"pro_credit_capacity":"basic_paid_credits";
  const hasPaidAccess=async()=>{
    if(env.PLAN_ENTITLEMENTS_ENABLED!=="true")return false;
    const permission=await callSafe(()=>authorizePlanFeature(env,userId,feature));
    return permission?.allowed===true;
  };
  if(paidPlanGate && !await hasPaidAccess())
    return declined("paid_plan_entitlement_rejected");
  const budgetId="ai:"+requestId;
  const budget=await callSafe(()=>providerBudget.reserve({
    id:budgetId,provider:policy.provider,model:policy.model,
    maximumMicroUsd:quote.maximumMicroUsd
  }));
  if(budget?.ok!==true) return declined("provider_budget_reservation_rejected");
  const wallet=await callSafe(()=>ledger.reserve(env,{
    userId,requestId,amountMicrocredits:quote.reservedMicrocredits
  }));
  if(wallet?.ok!==true){
    // Definitely no provider request. Release budget if possible; if not,
    // separate reconciliation must inspect the remaining reserved budget.
    const release=await callSafe(()=>providerBudget.settle({
      id:budgetId,actualMicroUsd:0n
    }));
    return declined(release?.ok===true?
      "credit_reservation_rejected":"credit_rejected_budget_hold_for_review");
  }
  const entry={attemptId,requestId,provider:policy.provider,
    model:policy.model,rateVersion:policy.version};
  // A failed/ambiguous dispatch journal acknowledgment may still mean a
  // write committed remotely. Do NOT invoke a paid provider OR auto-release
  // wallet/budget without independent review of the journal state.
  const dispatch=await callSafe(()=>journal(env,{...entry,kind:"dispatched"}));
  if(dispatch?.ok!==true)
    return declined("journal_dispatch_unconfirmed_reservations_held");
  let response;
  try {
    response=await invokeModel({
      model:policy.model,maxOutputTokens,maxInputTokens
    });
  } catch {
    await callSafe(()=>journal(env,{...entry,kind:"outcome_unknown"}));
    return declined("provider_outcome_unknown_reservations_held",true);
  }
  const usage=strictProviderTokenUsage(response?.usage);
  if(!usage){
    await callSafe(()=>journal(env,{...entry,kind:"usage_unverified"}));
    return declined("metering_unverified_reservations_held",true);
  }
  const measured=await callSafe(()=>journal(env,{
    ...entry,kind:"usage_measured",usage:response.usage,tariff:policy
  }));
  if(measured?.ok!==true)
    return declined("journal_measured_unconfirmed_reservations_held",true);
  const cost=calculateProviderCostMicroUsd({
    inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,
    inputRateMicroUsdPerMillion:policy.inputRateMicroUsdPerMillion,
    outputRateMicroUsdPerMillion:policy.outputRateMicroUsdPerMillion
  });
  let debit;
  try { debit=price(cost,policy); }
  catch { return declined("inference_cost_over_ceiling_reservations_held",true); }
  if(usage.inputTokens>maxInputTokens || usage.outputTokens>maxOutputTokens ||
      cost>quote.maximumMicroUsd || debit>quote.reservedMicrocredits ||
      cost>policy.maxCallMicroUsd || debit>policy.maxCallMicrocredits)
    return declined("inference_cost_over_ceiling_reservations_held",true);
  // A refund/revocation after provider dispatch must never deliver an
  // answer. Upstream cost may already exist: hold both reservations for
  // operator reconciliation instead of releasing them as a free call.
  if(paidPlanGate && !await hasPaidAccess())
    return declined("paid_plan_revoked_reservations_held",true);
  const budgetSettled=await callSafe(()=>providerBudget.settle({
    id:budgetId,actualMicroUsd:cost
  }));
  if(budgetSettled?.ok!==true)
    return declined("provider_budget_settlement_failed_reservations_held",true);
  const walletSettled=await callSafe(()=>ledger.finalize(env,{
    userId,requestId,settledMicrocredits:debit
  }));
  if(walletSettled?.ok!==true)
    return declined("credit_settlement_failed_reservation_held",true);
  // The plan may be revoked while either settlement is in flight. Financial
  // writes already committed; never claim rollback, but withhold paid output.
  if(paidPlanGate && !await hasPaidAccess())
    return declined("paid_plan_revoked_after_settlement",true);
  return {
    ok:true,modelInvoked:true,response,
    inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,
    providerCostMicroUsd:cost,customerDebitMicrocredits:debit,
    tariffVersion:policy.version
  };
}

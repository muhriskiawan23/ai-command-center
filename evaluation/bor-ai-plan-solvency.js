// Offline USD worst-case review, never live billing or a tariff approval.
// Charge 100% of every spendable credit, including prior lots, in this window.
import {CREDIT_POLICY} from "./bor-ai-credit-scenarios.js";
const BPS=10000n,USD=1000000n;
const ceil=(a,b)=>(a+b-1n)/b;
function whole(x,name){
  if(!Number.isSafeInteger(x)||x<0)throw new TypeError(name+" must be a nonnegative safe integer");
  return BigInt(x);
}
function bps(x,name){
  const n=whole(x,name);
  if(n>BPS)throw new RangeError(name+" must be <= 10000 basis points");
  return n;
}
export function assessPlanSolvency({
  plan,lockedFxIdrPerUsd,gatewayFeeIdr,gatewayFeeTaxBps,
  revenueTaxBps,fxLeakageBps,refundReserveBps,providerOverrunBps,
  otherVariableMicroUsd,monthlyFixedMicroUsd,monthlyFreeSubsidyMicroUsd,
  payingAccounts,rolloverCredits,outstandingTopupCredits,requiredMarginBps
}={}){
  if(typeof plan!=="string"||!Object.hasOwn(CREDIT_POLICY.plans,plan))
    throw new TypeError("Known paid plan required");
  const chosen=CREDIT_POLICY.plans[plan];
  const fx=whole(lockedFxIdrPerUsd,"lockedFxIdrPerUsd");
  const count=whole(payingAccounts,"payingAccounts");
  if(fx===0n||count===0n)throw new RangeError("FX and payingAccounts must be positive");
  const fee=whole(gatewayFeeIdr,"gatewayFeeIdr");
  const feeTax=bps(gatewayFeeTaxBps,"gatewayFeeTaxBps");
  const salesTax=bps(revenueTaxBps,"revenueTaxBps");
  const leakage=bps(fxLeakageBps,"fxLeakageBps");
  const refund=bps(refundReserveBps,"refundReserveBps");
  const overrun=bps(providerOverrunBps,"providerOverrunBps");
  const required=bps(requiredMarginBps,"requiredMarginBps");
  const variable=whole(otherVariableMicroUsd,"otherVariableMicroUsd");
  const fixed=whole(monthlyFixedMicroUsd,"monthlyFixedMicroUsd");
  const free=whole(monthlyFreeSubsidyMicroUsd,"monthlyFreeSubsidyMicroUsd");
  const rollover=whole(rolloverCredits,"rolloverCredits");
  const topup=whole(outstandingTopupCredits,"outstandingTopupCredits");
  const gross=chosen.usdCents*10000n;
  const grossIdr=ceil(gross*fx,USD);
  // Convert a concrete locked IDR fee incl. its stipulated tax back to USD.
  // Never treat the small upward-rounded IDR checkout excess as extra profit.
  const gatewayCostMicroUsd=ceil((fee+ceil(fee*feeTax,BPS))*USD,fx);
  const revenueTaxMicroUsd=ceil(gross*salesTax,BPS);
  const fxLossMicroUsd=ceil(gross*leakage,BPS);
  const refundReserveMicroUsd=ceil(gross*refund,BPS);
  const allocatedFixedMicroUsd=ceil((fixed+free),count);
  const nonProvider=gatewayCostMicroUsd+revenueTaxMicroUsd+fxLossMicroUsd+
    refundReserveMicroUsd+variable+allocatedFixedMicroUsd;
  const totalCredits=chosen.proposedCredits+rollover+topup;
  const providerCostMicroUsd=ceil(totalCredits*CREDIT_POLICY.microUsdPerCredit*(BPS+overrun),BPS);
  const totalCostMicroUsd=nonProvider+providerCostMicroUsd;
  const remainingMicroUsd=gross-totalCostMicroUsd;
  const minimumSurplusMicroUsd=ceil(gross*required,BPS);
  const providerRoom=gross-nonProvider-minimumSurplusMicroUsd;
  const maximumAffordableCredits=providerRoom<0n?0n:
    providerRoom*BPS/(CREDIT_POLICY.microUsdPerCredit*(BPS+overrun));
  const rolloverRoom=maximumAffordableCredits-chosen.proposedCredits-topup;
  const maxRolloverCredits=rolloverRoom>0n?rolloverRoom:0n;
  const beforeFixed=gross-(nonProvider-allocatedFixedMicroUsd)-providerCostMicroUsd;
  return Object.freeze({
    scope:"offline_proposed_usd_plan_solvency",plan,grossMicroUsd:gross,grossIdr,
    includedCredits:chosen.proposedCredits,totalSpendableCredits:totalCredits,
    gatewayCostMicroUsd,revenueTaxMicroUsd,fxLossMicroUsd,refundReserveMicroUsd,
    otherVariableMicroUsd:variable,allocatedFixedMicroUsd,providerCostMicroUsd,
    totalCostMicroUsd,remainingMicroUsd,minimumSurplusMicroUsd,
    passesScenarioGate:remainingMicroUsd>=minimumSurplusMicroUsd,
    maximumAffordableCredits,maxRolloverCredits,
    // Homogeneous cohort under these inputs, not a blended Basic/Pro forecast.
    breakEvenAccounts:beforeFixed>0n?ceil(fixed+free,beforeFixed):null,
    rolloverEnabled:false,tariffVerified:false,canActivateBilling:false
  });
}

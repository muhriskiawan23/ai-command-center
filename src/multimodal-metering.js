// Pure upper-bound quotes, not approved customer tariffs or invoice evidence.
// Never import a browser-selected price or assume that missing usage is free.
import {calculateProviderCostMicroUsd} from "./credit-metering.js";
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const ceil=(a,b)=>(a+b-1n)/b;
function positive(value,label){
  if(typeof value!=="bigint"||value<=0n||value>MAX)throw new TypeError("Positive safe "+label+" required");
  return value;
}
export function checkedMediaTariff(tariff,model){
  if(!tariff||tariff.approved!==true||tariff.provider!=="cloudflare-workers-ai"||
    tariff.model!==model||typeof tariff.version!=="string"||!VERSION.test(tariff.version))
    throw new TypeError("Matching server-approved media tariff required");
  const policy={...tariff};
  if(!Number.isSafeInteger(policy.callTimeoutMs)||policy.callTimeoutMs<1||policy.callTimeoutMs>45000)
    throw new TypeError("Bounded server media timeout required");
  for(const key of ["creditNumerator","creditDenominator","maxJobMicroUsd","maxJobMicrocredits"])
    policy[key]=positive(policy[key],key);
  if(policy.pricing==="tokens"){
    for(const key of ["inputRateMicroUsdPerMillion","outputRateMicroUsdPerMillion"])
      policy[key]=positive(policy[key],key);
    if(!Number.isSafeInteger(policy.maxInputTokens)||policy.maxInputTokens<1||policy.maxInputTokens>32000||
      !Number.isSafeInteger(policy.maxOutputTokens)||policy.maxOutputTokens<1||policy.maxOutputTokens>512)
      throw new TypeError("Bounded server token limits required");
  }else if(policy.pricing==="image-megapixels"){
    // Conservative reservation only. Rounding/billing must be independently
    // confirmed by the trusted measurement adapter before settlement.
    for(const key of ["pixelsPerMegapixel","firstOutputMpMicroUsd","extraOutputMpMicroUsd","inputMpMicroUsd"])
      policy[key]=positive(policy[key],key);
    if(policy.pixelsPerMegapixel>1048576n)throw new TypeError("Conservative MP size required");
  }else throw new TypeError("Supported media pricing unit required");
  return Object.freeze(policy);
}
export function mediaCreditsForCost(cost,policy){
  positive(cost,"provider cost");
  const credits=ceil(cost*policy.creditNumerator,policy.creditDenominator);
  return positive(credits,"credit debit");
}
export function quoteMediaOperation(operation,tariff){
  const policy=checkedMediaTariff(tariff,operation.model);
  let maximum;
  if(operation.kind==="vision"&&policy.pricing==="tokens"){
    maximum=BigInt(operation.calls.length)*calculateProviderCostMicroUsd({
      inputTokens:policy.maxInputTokens,outputTokens:policy.maxOutputTokens,
      inputRateMicroUsdPerMillion:policy.inputRateMicroUsdPerMillion,
      outputRateMicroUsdPerMillion:policy.outputRateMicroUsdPerMillion
    });
  }else if(operation.kind==="image"&&policy.pricing==="image-megapixels"){
    const output=ceil(BigInt(operation.width)*BigInt(operation.height),policy.pixelsPerMegapixel);
    const input=operation.referenceDimensions.reduce((sum,{width,height})=>
      sum+ceil(BigInt(width)*BigInt(height),policy.pixelsPerMegapixel),0n);
    maximum=policy.firstOutputMpMicroUsd+(output-1n)*policy.extraOutputMpMicroUsd+input*policy.inputMpMicroUsd;
  }else throw new TypeError("Media model and pricing units must match");
  const credits=mediaCreditsForCost(maximum,policy);
  return Object.freeze({policy,maximumMicroUsd:maximum,reservedMicrocredits:credits,
    allowed:maximum<=policy.maxJobMicroUsd&&credits<=policy.maxJobMicrocredits});
}

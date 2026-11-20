// OFFLINE STAGING PROOF ONLY. No production imports, HTTP route, provider calls
// or real credits. This module accepts only the result of a *server-injected*
// provider invocation; NEVER accept browser-supplied usage, IDs or rate cards.
import {
  reserveSyntheticCredits,settleSyntheticCredits
} from './billing-synthetic-usage-reservations.js';

const MAX_TOKENS=1_000_000_000;
const sources=Object.freeze(['openai-chat-completions','cloudflare-workers-ai']);
const smallText=(v,name)=>{
  if(typeof v!=='string'||!v.trim()||v.length>128)
    throw new TypeError(name+' must be a non-empty bounded string');
  return v;
};
const tokens=(v,name)=>{
  if(!Number.isSafeInteger(v)||v<0||v>MAX_TOKENS)
    throw new TypeError(name+' must be a nonnegative measured integer');
  return v;
};
function usageObject(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new TypeError('missing_authenticated_provider_usage');
  return raw;
}
function normalTokenPair(usage){
  const prompt=tokens(usage.prompt_tokens,'prompt_tokens');
  const completion=tokens(usage.completion_tokens,'completion_tokens');
  const total=tokens(usage.total_tokens,'total_tokens');
  if(prompt+completion!==total)
    throw new TypeError('provider_total_tokens_mismatch');
  // An all-zero receipt is NOT evidence of zero provider charge. Keep the
  // reserved hold for authoritative reconciliation instead of releasing it.
  if(total===0)throw new TypeError('provider_zero_usage_requires_reconciliation');
  return {inputTokens:prompt,outputTokens:completion};
}
function noUnpricedModality(usage){
  // Cached tokens are conservatively charged at the full input rate.
  // Explicit audio/image/video/speech modalities cannot be billed using
  // text-only tariffs, even when the model also reports token totals.
  const restricted=/(?:audio|image|video|speech)[_-](?:tokens|units)$/i;
  for(const part of [usage,usage.prompt_tokens_details,usage.completion_tokens_details]){
    if(part===undefined||part===null)continue;
    const details=usageObject(part);
    for(const [field,value] of Object.entries(details)){
      if(restricted.test(field) && value!==undefined && value!==null){
        if(tokens(value,field)>0)
          throw new Error('unpriced_modality_must_reconcile');
      }
    }
  }
}
export function parseProviderTextTokenReceipt({
  providerKind,expectedModelId,providerResponse
}){
  if(!sources.includes(providerKind))throw new TypeError('unapproved_metering_provider');
  smallText(expectedModelId,'expectedModelId');
  if(!providerResponse||typeof providerResponse!=='object'||
    Array.isArray(providerResponse)||typeof providerResponse.getReader==='function')
    throw new TypeError('invalid_provider_response');
  if(providerKind==='openai-chat-completions'){
    // The server must pin the actual model, not infer one from client input.
    if(providerResponse.model!==expectedModelId||
       typeof providerResponse.id!=='string'||
       !/^chatcmpl-[A-Za-z0-9_-]{6,128}$/.test(providerResponse.id)||
       providerResponse.object!=='chat.completion')
      throw new Error('provider_response_identity_mismatch');
  }else{
    // Direct Cloudflare env.AI.run may not return an explicit model field;
    // model identity is bound to the *server-owned* AI binding invocation.
    // If the response does include model, require exact match.
    if(providerResponse.model!==undefined&&
       providerResponse.model!==expectedModelId)
      throw new Error('provider_response_identity_mismatch');
  }
  const usage=usageObject(providerResponse.usage);
  noUnpricedModality(usage);
  const amount=normalTokenPair(usage);
  return Object.freeze({
    providerKind,modelId:expectedModelId,
    ...amount,
    measured:true,verifiedPricing:false,
    // The caller must additionally attach approved provider rate card and
    // reconcile actual cash costs before any production customer settlement.
    usageSource:'server_injected_provider_result',
    realCustomerBillingEnabled:false
  });
}

export async function simulateOfflineMeteredModelCall({
  db,userId,requestId,nowMs,providerKind,tariff,invoke
}){
  if(!sources.includes(providerKind))throw new TypeError('unapproved_metering_provider');
  if(!tariff||typeof tariff!=='object'||Array.isArray(tariff)||
     tariff.maxToolCredits!==0)
    throw new TypeError('tool credits must be separately verified and metered');
  if(typeof invoke!=='function')
    throw new TypeError('a server-injected nonstream provider invocation is required');
  smallText(tariff.modelId,'modelId');
  const held=await reserveSyntheticCredits(db,{
    userId,requestId,nowMs,...tariff
  });
  if(held.duplicate){
    // A repeated HTTP request MUST NOT re-invoke a billable provider.
    // If the first invocation is still in-flight, hold remains until an
    // independent authoritative bill/receipt resolves it.
    return Object.freeze({
      status:held.status==='held'?'reconciliation_required':'already_finalized',
      duplicate:true,providerInvoked:false,requestId,
      realCreditsGranted:false
    });
  }
  let response;
  try{
    // In tests this is a synthetic adapter. Real wiring needs audited caller
    // auth and provider identity, request correlation, rates and egress limits.
    response=await invoke({modelId:tariff.modelId,
      maxInputTokens:tariff.maxInputTokens,
      maxOutputTokens:tariff.maxOutputTokens});
  }catch{
    return Object.freeze({
      status:'reconciliation_required',reason:'provider_failure_or_ambiguous_bill',
      duplicate:false,providerInvoked:true,requestId,realCreditsGranted:false
    });
  }
  let measured;
  try{
    measured=parseProviderTextTokenReceipt({
      providerKind,expectedModelId:tariff.modelId,providerResponse:response
    });
  }catch{
    return Object.freeze({
      status:'reconciliation_required',reason:'missing_or_invalid_provider_metering',
      duplicate:false,providerInvoked:true,requestId,realCreditsGranted:false
    });
  }
  try{
    const result=await settleSyntheticCredits(db,{
      userId,requestId,nowMs:nowMs+1,measured:true,
      inputTokens:measured.inputTokens,outputTokens:measured.outputTokens,
      toolCreditsUsed:0
    });
    return Object.freeze({
      status:'settled',requestId,providerInvoked:true,
      inputTokens:measured.inputTokens,outputTokens:measured.outputTokens,
      billedCredits:result.billedCredits,
      releasedUnusedCredits:result.releasedUnusedCredits,
      duplicate:false,realCreditsGranted:false
    });
  }catch{
    // Do not expose internal SQL/provider details or make a second call.
    // The reserved hold remains, so a trusted operator can reconcile.
    return Object.freeze({
      status:'reconciliation_required',reason:'settlement_failed_or_over_cap',
      duplicate:false,providerInvoked:true,requestId,realCreditsGranted:false
    });
  }
}

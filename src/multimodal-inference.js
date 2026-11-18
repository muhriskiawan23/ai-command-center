// Opt-in integration coordinator. The media HTTP boundary is disabled by
// default and requires trusted server runtime/decoder/moderation wiring.
// Server-owned tariff + trusted receipt adapter are mandatory; no default AI,
// pricing, approval, upload, moderation or payment integration is installed.
import {authorizePlanFeature,minimumPlanForFeature} from "./plan-entitlements.js";
import {buildImageUnderstandingRequest,buildImageGenerationRequest,buildVideoFrameAnalysisPlan} from "./multimodal-contract.js";
import {decodeImageDataUri} from "../public/media-validation.js";
import {quoteMediaOperation,mediaCreditsForCost} from "./multimodal-metering.js";
import {reserveCredits,finalizeCredits} from "./credit-ledger.js";
import {providerSpendBudget} from "./provider-spend-budget.js";

const OPAQUE=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,89}$/;
const own=(object,key)=>Object.hasOwn(object,key);
const safe=async fn=>{try{return await fn()}catch{return null}};
const denied=(reason,calls=0)=>({ok:false,reason,modelInvoked:calls>0,dispatchedCalls:calls});
function keys(value,allowed){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    Object.keys(value).some(key=>!allowed.includes(key)))
    throw new TypeError("Unexpected client media fields");
}
// Authorization follows the actual size/reference count, never a claimed
// action/feature/tier from the browser. Preparation has no financial effects.
export function prepareMultimodalOperation(request){
  keys(request,["action","input"]);
  const {action,input}=request;
  if(action==="describe_image"){
    keys(input,["imageDataUri","question"]);
    const call=buildImageUnderstandingRequest(input);
    return Object.freeze({kind:"vision",model:call.model,feature:call.requiredFeature,calls:Object.freeze([call])});
  }
  if(["generate_image","create_wallpaper","edit_image"].includes(action)){
    keys(input,["prompt","width","height","references"]);
    if(action==="edit_image"&&(!Array.isArray(input.references)||input.references.length===0))
      throw new TypeError("Image editing requires a reference");
    const call=buildImageGenerationRequest({...input,wallpaper:action==="create_wallpaper"});
    return Object.freeze({kind:"image",model:call.model,feature:call.requiredFeature,
      width:call.width,height:call.height,referenceDimensions:call.referenceDimensions,calls:Object.freeze([call])});
  }
  if(action==="analyze_video_frames"){
    keys(input,["frames","durationSeconds","question"]);
    if(Array.isArray(input.frames))for(const frame of input.frames)keys(frame,["atSeconds","imageDataUri"]);
    const plan=buildVideoFrameAnalysisPlan(input);
    return Object.freeze({kind:"vision",model:plan.frames[0].model,feature:plan.requiredFeature,
      mode:plan.mode,audioAnalyzed:false,calls:plan.frames});
  }
  throw new TypeError("Unknown media action");
}
export async function appendMediaUsageEvent(env,entry){
  const {attemptId,requestId,provider,model,rateVersion,feature,kind,providerCostMicroUsd}=entry;
  const id=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
  if(typeof attemptId!=="string"||!id.test(attemptId)||typeof requestId!=="string"||!id.test(requestId)||
    provider!=="cloudflare-workers-ai"||typeof model!=="string"||!/^@cf\/[A-Za-z0-9/._:-]{1,176}$/.test(model)||
    typeof rateVersion!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(rateVersion))
    throw new TypeError("Bounded media journal scope required");
  minimumPlanForFeature(feature);
  if(kind==="usage_measured"&&(typeof providerCostMicroUsd!=="bigint"||providerCostMicroUsd>BigInt(Number.MAX_SAFE_INTEGER)))
    throw new TypeError("Safe bigint media measurement required");
  if(kind!=="usage_measured"&&providerCostMicroUsd!==undefined)throw new TypeError("Only measured media events carry cost");
  const cost=kind==="usage_measured"?Number(providerCostMicroUsd):null;
  if(!["dispatched","usage_measured","outcome_unknown","usage_unverified"].includes(kind)||
    (kind==="usage_measured"&&(!Number.isSafeInteger(cost)||cost<=0)))
    throw new TypeError("Valid measured media journal event required");
  const row=await env.DB.prepare("INSERT INTO media_usage_events "+
    "(attempt_id,event_kind,request_id,provider,model,rate_version,feature,provider_cost_micro_usd,created_at) "+
    "VALUES (?,?,?,?,?,?,?,?,?) RETURNING attempt_id,event_kind"
  ).bind(attemptId,kind,requestId,provider,model,rateVersion,feature,cost,Math.floor(Date.now()/1000)).first();
  return {ok:row?.attempt_id===attemptId&&row?.event_kind===kind};
}
function receiptCost(receipt,scope){
  if(!receipt||receipt.measured!==true||
    ["attemptId","requestId","provider","model","rateVersion"].some(key=>receipt[key]!==scope[key])||
    typeof receipt.providerCostMicroUsd!=="bigint"||receipt.providerCostMicroUsd<=0n||
    receipt.providerCostMicroUsd>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return receipt.providerCostMicroUsd;
}
function checkedOutput(response,operation,call){
  // Enforce provider completion integrity at the coordinator too: a trusted
  // runtime may use a different invoker than createCloudflareMediaInvoker.
  // A seemingly valid answer/image with an explicit error or non-success
  // completion marker must never be delivered as a successful paid output.
  if(!response||typeof response!=="object"||Array.isArray(response)||
    (response.error!==undefined&&response.error!==null)||
    (operation.kind==="vision"&&response.finish_reason!==undefined&&response.finish_reason!=="stop"))
    throw new TypeError("Unverified media provider completion");
  if(operation.kind==="image"){
    // The binding's native image result must be normalized by the trusted
    // provider adapter. Do not return arbitrary URLs/HTML or request uploads.
    const image=decodeImageDataUri(response?.imageDataUri,{maxBytes:8*1024*1024});
    if(image.width!==operation.width||image.height!==operation.height)
      throw new TypeError("Generated image dimensions differ from quote");
    return Object.freeze({imageDataUri:image.dataUri,provenance:"AI-generated-or-edited"});
  }
  if(typeof response?.answer!=="string"||response.answer.trim().length===0||response.answer.length>16000||
    /[\u0000-\u0008\u000e-\u001f]/.test(response.answer))throw new TypeError("Bounded media answer required");
  return Object.freeze({answer:response.answer,...(own(call,"atSeconds")?{atSeconds:call.atSeconds}:{})});
}
function invokeWithDeadline(invoke,args,parentSignal,timeoutMs){
  const controller=new AbortController();
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(ok,value)=>{
      if(done)return;done=true;clearTimeout(timer);
      parentSignal?.removeEventListener("abort",abort);
      ok?resolve(value):reject(value);
    };
    const abort=()=>{controller.abort();finish(false,new Error("Media provider outcome unknown after cancellation"))};
    const timer=setTimeout(()=>{controller.abort();finish(false,new Error("Media provider deadline exceeded"))},timeoutMs);
    parentSignal?.addEventListener("abort",abort,{once:true});
    if(parentSignal?.aborted)abort();
    // Both eventual resolve/reject handlers stay attached after timeout so a
    // late upstream response cannot settle credits, publish output or escape
    // as an unhandled rejection. Aborting is not proof of zero provider cost.
    Promise.resolve().then(()=>{
      if(controller.signal.aborted)throw new Error("Media call cancelled");
      return invoke({...args,signal:controller.signal});
    }).then(value=>finish(true,value),error=>finish(false,error));
  });
}
export async function runMultimodalInferencePrototype(options){
  const {signal,jobTimeoutMs=90000}=options;
  if(!Number.isSafeInteger(jobTimeoutMs)||jobTimeoutMs<1||jobTimeoutMs>120000)
    throw new TypeError("Bounded media job deadline required");
  const controller=new AbortController(),progress={calls:0};
  const abort=()=>controller.abort();
  signal?.addEventListener("abort",abort,{once:true});
  if(signal?.aborted)abort();
  let timer;
  const deadline=new Promise(resolve=>{
    timer=setTimeout(()=>{controller.abort();resolve(denied("media_job_deadline_exceeded_reservations_held",progress.calls));},jobTimeoutMs);
  });
  try{
    // A late DB acknowledgement can still commit. Do not undo it blindly.
    // The cancelled worker can finish conservative bookkeeping, but the
    // signal prevents further provider dispatch and outputs are never sent
    // after this deadline. The losing promise always has rejection handling.
    return await Promise.race([runMediaJob({...options,signal:controller.signal,progress}),deadline]);
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
async function runMediaJob({
  env,userId,requestId,request,tariffs,invokeModel,measureUsage,signal,
  maximumMicrocredits,validateOutput,progress,
  journal=appendMediaUsageEvent,
  ledger={reserve:reserveCredits,finalize:finalizeCredits},providerBudget
}){
  if(!env?.DB?.prepare||typeof userId!=="string"||!OPAQUE.test(userId)||typeof requestId!=="string"||!OPAQUE.test(requestId)||
    typeof invokeModel!=="function"||typeof measureUsage!=="function"||typeof journal!=="function"||
    typeof ledger?.reserve!=="function"||typeof ledger?.finalize!=="function")
    throw new TypeError("Authenticated server scope and trusted media adapters required");
  // A missing flag MUST NOT bypass authorization (unlike an unrestricted
  // synthetic callback). Synthetic tests explicitly enable entitlement checks.
  if(env.PLAN_ENTITLEMENTS_ENABLED!=="true")return denied("paid_plans_not_active");
  if(signal?.aborted)return denied("cancelled_before_reservation");
  const operation=prepareMultimodalOperation(request);
  const candidate=tariffs?.[operation.model];
  const tariff=candidate?{...candidate}:undefined;
  const permission=await safe(()=>authorizePlanFeature(env,userId,operation.feature));
  if(permission?.allowed!==true)return denied("paid_plan_entitlement_rejected");
  const quote=quoteMediaOperation(operation,tariff);
  if(!quote.allowed)return denied("media_job_spend_ceiling_exceeded");
  if(maximumMicrocredits!==undefined){
    if(typeof maximumMicrocredits!=="bigint"||maximumMicrocredits<1n||maximumMicrocredits>BigInt(Number.MAX_SAFE_INTEGER))
      throw new TypeError("Safe customer credit ceiling required");
    if(quote.reservedMicrocredits>maximumMicrocredits)return denied("customer_credit_ceiling_exceeded");
  }
  const policy=quote.policy;
  const budget=providerBudget??providerSpendBudget(env);
  if(typeof budget?.reserve!=="function"||typeof budget?.settle!=="function")throw new TypeError("Provider budget adapter required");
  const id="media:"+requestId;
  const reserved=await safe(()=>budget.reserve({id,provider:policy.provider,model:operation.model,maximumMicroUsd:quote.maximumMicroUsd}));
  if(reserved?.ok!==true)return denied("provider_budget_reservation_rejected");
  const wallet=await safe(()=>ledger.reserve(env,{userId,requestId:id,amountMicrocredits:quote.reservedMicrocredits}));
  if(wallet?.ok!==true){
    const release=await safe(()=>budget.settle({id,actualMicroUsd:0n}));
    return denied(release?.ok===true?"credit_reservation_rejected":"credit_rejected_budget_hold_for_review");
  }
  let calls=0,cost=0n;
  const outputs=[];
  for(let index=0;index<operation.calls.length;index++){
    const call=operation.calls[index];
    const access=await safe(()=>authorizePlanFeature(env,userId,operation.feature));
    if(signal?.aborted||access?.allowed!==true){
      // No dispatch at all is the only automatically releasable outcome.
      if(calls===0){
        const a=await safe(()=>budget.settle({id,actualMicroUsd:0n}));
        const b=a?.ok===true?await safe(()=>ledger.finalize(env,{userId,requestId:id,settledMicrocredits:0n})):null;
        return denied(b?.ok===true?"cancelled_before_dispatch":"pre_dispatch_release_unconfirmed_hold_for_review");
      }
      return denied("media_job_interrupted_reservations_held",calls);
    }
    const scope={attemptId:id+":"+index,requestId:id,provider:policy.provider,model:operation.model,
      rateVersion:policy.version,feature:operation.feature};
    const dispatched=await safe(()=>journal(env,{...scope,kind:"dispatched"}));
    if(dispatched?.ok!==true)return denied("journal_dispatch_unconfirmed_reservations_held",calls);
    if(signal?.aborted)return denied("cancelled_after_dispatch_marker_reservations_held",calls);
    // The tariff's explicit output limit must also reach the real call.
    const payload=operation.kind==="vision"?{...call.payload,max_tokens:policy.maxOutputTokens}:call.payload;
    let response;
    calls++;
    progress.calls=calls;
    try{response=await invokeWithDeadline(invokeModel,{model:operation.model,payload,maxInputTokens:policy.maxInputTokens,
      ...scope},signal,policy.callTimeoutMs);}
    catch{
      await safe(()=>journal(env,{...scope,kind:"outcome_unknown"}));
      return denied("provider_outcome_unknown_reservations_held",calls);
    }
    // Receipt verification is a server adapter, never a boolean supplied in
    // an uploaded JSON body. It must attest model/attempt/rate AND actual cost.
    const receipt=await safe(()=>invokeWithDeadline(({signal:stepSignal})=>measureUsage({...scope,response,policy,signal:stepSignal,
      bounds:Object.freeze({maxInputTokens:policy.maxInputTokens,maxOutputTokens:policy.maxOutputTokens,
        width:operation.width,height:operation.height,referenceDimensions:operation.referenceDimensions})}),{},signal,policy.callTimeoutMs));
    const measured=receiptCost(receipt,scope);
    if(measured===null){
      await safe(()=>journal(env,{...scope,kind:"usage_unverified"}));
      return denied("media_usage_unverified_reservations_held",calls);
    }
    const event=await safe(()=>journal(env,{...scope,kind:"usage_measured",providerCostMicroUsd:measured}));
    if(event?.ok!==true)return denied("journal_measured_unconfirmed_reservations_held",calls);
    cost+=measured;
    if(cost>quote.maximumMicroUsd)return denied("media_cost_over_ceiling_reservations_held",calls);
    try{
      let output=checkedOutput(response,operation,call);
      if(validateOutput!==undefined){
        if(typeof validateOutput!=="function")throw new TypeError("Output validator required");
        const reviewed=await invokeWithDeadline(({signal:stepSignal})=>validateOutput({output,feature:operation.feature,signal:stepSignal}),{},signal,policy.callTimeoutMs);
        if(reviewed?.ok!==true)throw new TypeError("Media output rejected");
        // Trusted validation may strip metadata/re-encode. Reapply the same
        // output shape/geometry/provenance bounds before returning its result.
        if(reviewed.output!==undefined)output=checkedOutput(reviewed.output,operation,call);
      }
      outputs.push(output);
    }
    catch{return denied("media_output_unverified_reservations_held",calls);}
  }
  const debit=mediaCreditsForCost(cost,policy);
  if(debit>quote.reservedMicrocredits)return denied("media_cost_over_ceiling_reservations_held",calls);
  if(signal?.aborted)return denied("media_job_interrupted_reservations_held",calls);
  // Entitlements must remain active through final provider usage and delivery.
  // Provider cost may already exist: keep holds pending audited reconciliation
  // instead of releasing them on a late refund or revocation.
  const finalAccess=await safe(()=>authorizePlanFeature(env,userId,operation.feature));
  if(finalAccess?.allowed!==true)
    return denied("media_final_entitlement_unverified_reservations_held",calls);
  if(signal?.aborted)return denied("media_job_interrupted_reservations_held",calls);
  const paid=await safe(()=>budget.settle({id,actualMicroUsd:cost}));
  if(paid?.ok!==true)return denied("provider_budget_settlement_failed_reservations_held",calls);
  const settled=await safe(()=>ledger.finalize(env,{userId,requestId:id,settledMicrocredits:debit}));
  if(settled?.ok!==true)return denied("credit_settlement_failed_reservation_held",calls);
  // A cancellation can arrive while either financial write is committing.
  // Finish confirmed bookkeeping, but never publish media to a cancelled job.
  // Already-settled costs cannot be blindly rolled back as if no call ran.
  if(signal?.aborted)return denied("cancelled_after_financial_settlement",calls);
  // Revocation could occur while settlement commits; never publish the result
  // just because a prior authorization check succeeded.
  const deliveryAccess=await safe(()=>authorizePlanFeature(env,userId,operation.feature));
  if(deliveryAccess?.allowed!==true)
    return denied("media_delivery_entitlement_revoked_after_settlement",calls);
  if(signal?.aborted)return denied("cancelled_after_financial_settlement",calls);
  return {ok:true,modelInvoked:true,dispatchedCalls:calls,feature:operation.feature,
    outputs:Object.freeze(outputs),providerCostMicroUsd:cost,customerDebitMicrocredits:debit,
    ...(operation.mode?{mode:operation.mode,audioAnalyzed:false}:{})};
}

// Read-only, coherent financial snapshot for the media namespace. The older
// token-only Stage 3 journal/audits are not evidence of media reconciliation.
export async function inspectMediaBilling(env){
  const row=await env.DB.prepare(`
    WITH jobs AS (
      SELECT b.id,b.provider,b.model,b.status AS budget_status,b.actual_micro_usd,
        c.status AS wallet_status,c.settled_microcredits,
        (SELECT COUNT(*) FROM media_usage_events d WHERE d.request_id=b.id AND d.event_kind='dispatched') AS dispatched,
        (SELECT COALESCE(SUM(m.provider_cost_micro_usd),0) FROM media_usage_events m
          WHERE m.request_id=b.id AND m.event_kind='usage_measured') AS measured_cost
      FROM provider_budget_reservations b
      LEFT JOIN credit_reservations c ON c.request_id=b.id
      WHERE substr(b.id,1,6)='media:'
    )
    SELECT
      (SELECT COUNT(*) FROM jobs) AS jobs,
      (SELECT COUNT(*) FROM jobs WHERE budget_status='reserved' OR wallet_status='reserved') AS held_jobs,
      (SELECT COUNT(*) FROM jobs WHERE budget_status='settled' AND actual_micro_usd!=measured_cost) AS cost_mismatches,
      (SELECT COUNT(*) FROM jobs WHERE dispatched>0 AND
        (wallet_status IS NULL OR wallet_status!='settled' OR settled_microcredits<=0
          OR budget_status!='settled' OR COALESCE(actual_micro_usd,0)<=0)) AS incomplete_dispatched_jobs,
      (SELECT COUNT(*) FROM media_usage_events d WHERE d.event_kind='dispatched' AND
        NOT EXISTS (SELECT 1 FROM media_usage_events m
          WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured')) AS unresolved_attempts,
      (SELECT COUNT(*) FROM (
        SELECT attempt_id FROM media_usage_events
        WHERE event_kind IN ('usage_measured','outcome_unknown','usage_unverified')
        GROUP BY attempt_id HAVING COUNT(*)>1
      )) AS terminal_conflicts,
      (SELECT COUNT(*) FROM media_usage_events d WHERE d.event_kind='dispatched' AND
        NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id=d.request_id
          AND j.provider=d.provider AND j.model=d.model)) AS orphan_or_mismatched_dispatches,
      (SELECT COUNT(*) FROM credit_reservations c WHERE substr(c.request_id,1,6)='media:' AND
        NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id=c.request_id)) AS orphan_wallets,
      (SELECT COUNT(*) FROM jobs WHERE budget_status='settled' AND
        ((dispatched=0 AND wallet_status='settled' AND settled_microcredits>0)
          OR (dispatched>0 AND wallet_status='released'))) AS invalid_wallet_settlements
  `).first();
  const names=["jobs","held_jobs","cost_mismatches","incomplete_dispatched_jobs","unresolved_attempts","terminal_conflicts",
    "orphan_or_mismatched_dispatches","orphan_wallets","invalid_wallet_settlements"];
  if(!row||names.some(name=>!Number.isSafeInteger(row[name])||row[name]<0))
    throw new Error("Media billing audit unavailable");
  return Object.freeze({...row,reviewRequired:names.slice(1).some(name=>row[name]>0),
    providerInvoiceVerified:false,scope:"inactive_media_journal_only"});
}

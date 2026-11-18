// Actual D1 finance/entitlement/journal adapters; fictional receipts, no AI calls.
import test from "node:test";
import assert from "node:assert/strict";
import {createD1,seedSession} from "./e2e/harness.js";
import {reserveCredits,finalizeCredits} from "../src/credit-ledger.js";
import {providerSpendBudget} from "../src/provider-spend-budget.js";
import {VISION_MODEL,IMAGE_MODEL,buildVideoFrameAnalysisPlan} from "../src/multimodal-contract.js";
import {prepareMultimodalOperation,runMultimodalInferencePrototype,appendMediaUsageEvent,inspectMediaBilling} from "../src/multimodal-inference.js";
import {quoteMediaOperation} from "../src/multimodal-metering.js";
import {pngDataUri} from "./helpers/media-fixtures.js";
import {createCloudflareMediaInvoker} from "../src/cloudflare-media-adapter.js";

const image=pngDataUri();
const describe={action:"describe_image",input:{imageDataUri:image,question:"Apa isi gambar ini?"}};
const generate={action:"generate_image",input:{prompt:"Pemandangan gunung yang indah.",width:256,height:256}};
const video={action:"analyze_video_frames",input:{durationSeconds:10,frames:[0,5].map(atSeconds=>({atSeconds,imageDataUri:image}))}};
// Deliberately fictional rates and receipts, not a customer/pricing decision.
const common={approved:true,provider:"cloudflare-workers-ai",version:"synthetic-media-v1",
  creditNumerator:2n,creditDenominator:1n,maxJobMicroUsd:100000n,maxJobMicrocredits:200000n,callTimeoutMs:10000};
const tariffs={
  [VISION_MODEL]:{...common,model:VISION_MODEL,pricing:"tokens",inputRateMicroUsdPerMillion:300000n,
    outputRateMicroUsdPerMillion:1000000n,maxInputTokens:2000,maxOutputTokens:512},
  [IMAGE_MODEL]:{...common,model:IMAGE_MODEL,pricing:"image-megapixels",pixelsPerMegapixel:1048576n,
    firstOutputMpMicroUsd:15000n,extraOutputMpMicroUsd:2000n,inputMpMicroUsd:2000n}
};
function fixture(t,{tier="pro",balance=1000000,globalCap=1000000}={}){
  const DB=createD1();t.after(()=>DB.sqlite.close());const sql=DB.sqlite;
  for(const id of ["alice","bob"])seedSession(DB,{id,email:id+"@example.test"});
  if(tier){
    const now=Math.floor(Date.now()/1000);
    sql.prepare("INSERT INTO verified_plan_payments VALUES (?,?,?,?,?,?)").run("proof-alice","alice",tier,"verified_paid",now-90,now);
    sql.prepare("INSERT INTO plan_entitlements VALUES (?,?,?,?,?,?,?)").run("alice",tier,"proof-alice","active",now-60,now+3600,now);
  }
  sql.prepare("INSERT INTO credit_accounts VALUES (?,?,1)").run("alice",balance);
  sql.prepare("INSERT INTO credit_accounts VALUES (?,?,1)").run("bob",balance);
  for(const [provider,cap] of [["cloudflare-workers-ai",1000000],["__global__",globalCap]])
    sql.prepare("INSERT INTO provider_budget_limits VALUES (?,?,1)").run(provider,cap);
  const env={DB,PLAN_ENTITLEMENTS_ENABLED:"true"};
  let calls=0;
  const invokeModel=async({model,payload})=>{
    calls++;
    if(model===VISION_MODEL){assert.equal(payload.max_tokens,512);return {answer:"Ini gambar uji sintetis."};}
    return {imageDataUri:pngDataUri({width:256,height:256})};
  };
  const measureUsage=async({attemptId,requestId,provider,model,rateVersion})=>({
    attemptId,requestId,provider,model,rateVersion,measured:true,providerCostMicroUsd:model===VISION_MODEL?400n:12000n
  });
  const run=(overrides={})=>runMultimodalInferencePrototype({env,userId:"alice",requestId:"job-1",request:describe,
    tariffs,invokeModel,measureUsage,...overrides});
  const scalar=(query,...params)=>sql.prepare(query).get(...params);
  const balanceOf=(user="alice")=>scalar("SELECT balance_microcredits n FROM credit_accounts WHERE user_id=?",user).n;
  const events=()=>sql.prepare("SELECT * FROM media_usage_events ORDER BY rowid").all();
  const reservation=()=>scalar("SELECT * FROM credit_reservations WHERE request_id='media:job-1'");
  const budget=()=>scalar("SELECT * FROM provider_budget_reservations WHERE id='media:job-1'");
  return {env,sql,run,scalar,balanceOf,events,reservation,budget,calls:()=>calls,measureUsage};
}
test("actual finance modules reserve, measure and settle image understanding once",async t=>{
  const x=fixture(t,{tier:"basic"});const r=await x.run();
  assert.equal(r.ok,true);assert.equal(r.dispatchedCalls,1);assert.equal(r.providerCostMicroUsd,400n);
  assert.equal(r.customerDebitMicrocredits,800n);assert.equal(x.balanceOf(),999200);
  assert.equal(x.reservation().settled_microcredits,800);assert.equal(x.budget().actual_micro_usd,400);
  assert.deepEqual(x.events().map(e=>e.event_kind),["dispatched","usage_measured"]);
  assert.equal(r.outputs[0].answer,"Ini gambar uji sintetis.");
  const replay=await x.run();assert.equal(replay.ok,false);assert.equal(x.calls(),1);assert.equal(x.balanceOf(),999200);
});
test("actual image-generation path quotes megapixels, charges measured cost and returns bounded output",async t=>{
  const x=fixture(t,{tier:"basic"});const r=await x.run({request:generate});
  assert.equal(r.ok,true);assert.equal(r.feature,"image_generation");assert.equal(r.providerCostMicroUsd,12000n);
  assert.equal(x.reservation().reserved_microcredits,30000);assert.equal(x.balanceOf(),976000);
  assert.match(r.outputs[0].imageDataUri,/^data:image\/png;base64,/);
  assert.equal(r.outputs[0].provenance,"AI-generated-or-edited");
});
test("single-reference image edits execute for Basic using their actual feature",async t=>{
  const x=fixture(t,{tier:"basic"});const r=await x.run({request:{action:"edit_image",input:{...generate.input,references:[image]}}});
  assert.equal(r.ok,true);assert.equal(r.feature,"image_editing");
  assert.equal(x.reservation().reserved_microcredits,34000);
});
test("Pro sampled video reserves the whole bundle first and records every measured frame",async t=>{
  const x=fixture(t);const r=await x.run({request:video});
  assert.equal(r.ok,true);assert.equal(r.dispatchedCalls,2);assert.equal(r.audioAnalyzed,false);
  assert.equal(r.mode,"sampled_visual_frames_only");assert.deepEqual(r.outputs.map(x=>x.atSeconds),[0,5]);
  assert.equal(x.reservation().reserved_microcredits,4448);assert.equal(x.balanceOf(),998400);
  assert.equal(x.events().length,4);
});
test("Free, another tenant, disabled entitlements and refunded Pro cannot spend media credits",async t=>{
  const x=fixture(t,{tier:null});
  assert.equal((await x.run()).reason,"paid_plan_entitlement_rejected");
  assert.equal((await x.run({userId:"bob"})).reason,"paid_plan_entitlement_rejected");
  assert.equal((await x.run({env:{DB:x.env.DB}})).reason,"paid_plans_not_active");
  assert.equal(x.calls(),0);assert.equal(x.events().length,0);assert.equal(x.balanceOf(),1000000);
});
test("Basic cannot disguise large images, multi-reference edits or video as a cheaper operation",async t=>{
  const x=fixture(t,{tier:"basic"});
  for(const request of [video,
    {action:"create_wallpaper",input:{...generate.input,width:1920,height:1080}},
    {action:"generate_image",input:{...generate.input,references:[image,image]}}
  ])assert.equal((await x.run({request})).reason,"paid_plan_entitlement_rejected");
  assert.equal(x.calls(),0);assert.equal(x.reservation(),undefined);assert.equal(x.budget(),undefined);
});
test("client features, tier, price, model and payload overrides never enter protected requests",()=>{
  for(const request of [{...describe,tier:"pro"},{...describe,credits:0},
    {...describe,input:{...describe.input,model:IMAGE_MODEL}},
    {...generate,input:{...generate.input,feature:"image_generation"}},
    {action:"edit_image",input:generate.input},
    {...video,input:{...video.input,frames:[{atSeconds:0,imageDataUri:image,feature:"chat"}]}}
  ])assert.throws(()=>prepareMultimodalOperation(request),/fields|reference/);
});
test("missing or mismatched tariffs and token/image pricing confusion reject before reservations",async t=>{
  const x=fixture(t);
  await assert.rejects(x.run({tariffs:{}}),/tariff/);
  await assert.rejects(x.run({tariffs:{[VISION_MODEL]:{...tariffs[IMAGE_MODEL],model:VISION_MODEL}}}),/pricing units/);
  await assert.rejects(x.run({tariffs:{[VISION_MODEL]:{...tariffs[VISION_MODEL],approved:false}}}),/tariff/);
  assert.equal(x.calls(),0);assert.equal(x.reservation(),undefined);
});
test("per-job quote ceiling rejects without reserving any money",async t=>{
  const x=fixture(t);const r=await x.run({tariffs:{[VISION_MODEL]:{...tariffs[VISION_MODEL],maxJobMicroUsd:1n}}});
  assert.equal(r.reason,"media_job_spend_ceiling_exceeded");assert.equal(x.calls(),0);assert.equal(x.budget(),undefined);
});
test("insufficient customer credit releases the unspent provider reservation",async t=>{
  const x=fixture(t,{balance:10});const r=await x.run();
  assert.equal(r.reason,"credit_reservation_rejected");assert.equal(x.balanceOf(),10);
  assert.equal(x.budget().actual_micro_usd,0);assert.equal(x.calls(),0);
});
test("missing global cap denies dispatch even when the wallet has ample credit",async t=>{
  const x=fixture(t);x.sql.prepare("DELETE FROM provider_budget_limits WHERE provider='__global__'").run();
  assert.equal((await x.run()).reason,"provider_budget_reservation_rejected");assert.equal(x.calls(),0);
  assert.equal(x.balanceOf(),1000000);
});
test("concurrent repeats cannot invoke or debit the same media job twice",async t=>{
  const x=fixture(t);const results=await Promise.all(Array.from({length:6},()=>x.run()));
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(x.calls(),1);assert.equal(x.balanceOf(),999200);
});
test("concurrent media jobs obey the aggregate provider/global spend ceiling",async t=>{
  const x=fixture(t,{globalCap:1200});
  const results=await Promise.all([x.run(),x.run({requestId:"job-2"})]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(x.calls(),1);
});
test("provider timeout retains both reservations and never returns media output",async t=>{
  const x=fixture(t);const r=await x.run({invokeModel:async()=>{throw Error("synthetic timeout")}});
  assert.equal(r.reason,"provider_outcome_unknown_reservations_held");assert.equal(r.modelInvoked,true);
  assert.equal(x.reservation().status,"reserved");assert.equal(x.budget().status,"reserved");
  assert.equal(r.outputs,undefined);assert.deepEqual(x.events().map(e=>e.event_kind),["dispatched","outcome_unknown"]);
});
test("a provider response saying measured is not itself trusted financial evidence",async t=>{
  const x=fixture(t);const r=await x.run({invokeModel:async()=>({answer:"test",measured:true,providerCostMicroUsd:1n}),measureUsage:async()=>null});
  assert.equal(r.reason,"media_usage_unverified_reservations_held");assert.equal(x.reservation().status,"reserved");
});
for(const key of ["attemptId","requestId","provider","model","rateVersion"]){
  test("receipt scope mismatch in "+key+" holds funds",async t=>{
    const x=fixture(t);const r=await x.run({measureUsage:async args=>({...await x.measureUsage(args),[key]:"other"})});
    assert.equal(r.reason,"media_usage_unverified_reservations_held");assert.equal(r.outputs,undefined);
  });
}
test("measured cost exceeding the quote is journaled for review, never silently charged",async t=>{
  const x=fixture(t);const r=await x.run({measureUsage:async args=>({...await x.measureUsage(args),providerCostMicroUsd:10000n})});
  assert.equal(r.reason,"media_cost_over_ceiling_reservations_held");assert.equal(x.budget().status,"reserved");
  assert.equal(x.events().at(-1).provider_cost_micro_usd,10000);assert.equal(r.outputs,undefined);
});
test("journal dispatch failure prevents any upstream call and preserves reservations",async t=>{
  const x=fixture(t);const r=await x.run({journal:async()=>({ok:false})});
  assert.equal(r.reason,"journal_dispatch_unconfirmed_reservations_held");assert.equal(x.calls(),0);
  assert.equal(x.reservation().status,"reserved");
});
test("measured-journal acknowledgement failure cannot expose paid output",async t=>{
  const x=fixture(t);const r=await x.run({journal:async(env,entry)=>entry.kind==="usage_measured"?{ok:false}:appendMediaUsageEvent(env,entry)});
  assert.equal(r.reason,"journal_measured_unconfirmed_reservations_held");assert.equal(r.outputs,undefined);
});
test("wallet settlement failure leaves held credits and suppresses output",async t=>{
  const x=fixture(t);const r=await x.run({ledger:{reserve:reserveCredits,finalize:async()=>({ok:false})}});
  assert.equal(r.reason,"credit_settlement_failed_reservation_held");assert.equal(x.reservation().status,"reserved");
  assert.equal(x.budget().actual_micro_usd,400);assert.equal(r.outputs,undefined);
});
test("provider settlement failure does not finalize the wallet",async t=>{
  const x=fixture(t);const actual=providerSpendBudget(x.env);
  const r=await x.run({providerBudget:{reserve:actual.reserve,settle:async()=>({ok:false})}});
  assert.equal(r.reason,"provider_budget_settlement_failed_reservations_held");assert.equal(x.reservation().status,"reserved");
});
test("malformed model output and mismatched output dimensions are held for review",async t=>{
  const x=fixture(t);const r=await x.run({request:generate,invokeModel:async()=>({imageDataUri:image})});
  assert.equal(r.reason,"media_output_unverified_reservations_held");assert.equal(r.outputs,undefined);
  assert.equal(x.events().at(-1).event_kind,"usage_measured");assert.equal(x.reservation().status,"reserved");
});
test("revoking Pro mid-video stops the next frame without releasing an uncertain job",async t=>{
  const x=fixture(t);let calls=0;
  const r=await x.run({request:video,invokeModel:async()=>{
    calls++;x.sql.prepare("UPDATE verified_plan_payments SET verification_status='refunded'").run();
    return {answer:"Frame pertama."};
  }});
  assert.equal(r.reason,"media_job_interrupted_reservations_held");assert.equal(calls,1);assert.equal(r.outputs,undefined);
  assert.equal(x.reservation().status,"reserved");
});
test("cancelling before dispatch safely releases both reservations exactly once",async t=>{
  const x=fixture(t);const controller=new AbortController();
  const r=await x.run({signal:controller.signal,ledger:{reserve:async(env,entry)=>{
    const r=await reserveCredits(env,entry);controller.abort();return r;
  },finalize:finalizeCredits}});
  assert.equal(r.reason,"cancelled_before_dispatch");assert.equal(x.calls(),0);assert.equal(x.balanceOf(),1000000);
  assert.equal(x.budget().actual_micro_usd,0);assert.equal(x.reservation().settled_microcredits,0);
});
test("cancelling after one video frame stops additional model requests and retains holds",async t=>{
  const x=fixture(t);const controller=new AbortController();let calls=0;
  const r=await x.run({request:video,signal:controller.signal,invokeModel:async()=>{calls++;return {answer:"Frame uji."}},
    journal:async(env,event)=>{const r=await appendMediaUsageEvent(env,event);if(event.kind==="usage_measured")controller.abort();return r;}});
  assert.equal(r.reason,"media_job_interrupted_reservations_held");assert.equal(calls,1);assert.equal(x.reservation().status,"reserved");
});
test("append-only media journal forbids UPDATE, DELETE, REPLACE and UPSERT rewrites",async t=>{
  const x=fixture(t);await x.run();
  for(const statement of ["UPDATE media_usage_events SET provider_cost_micro_usd=1 WHERE event_kind='usage_measured'",
    "DELETE FROM media_usage_events",
    "INSERT OR REPLACE INTO media_usage_events SELECT * FROM media_usage_events WHERE event_kind='usage_measured'",
    "INSERT INTO media_usage_events SELECT * FROM media_usage_events WHERE event_kind='usage_measured' ON CONFLICT(attempt_id,event_kind) DO UPDATE SET provider_cost_micro_usd=1"])
    assert.throws(()=>x.sql.exec(statement),/append_only/);
  assert.equal(x.events().at(-1).provider_cost_micro_usd,400);
});
test("journal stores financial scope, never raw media, answers, prompts or user identity",async t=>{
  const x=fixture(t);await x.run();const rows=JSON.stringify(x.events());
  assert.doesNotMatch(rows,/data:image|Apa isi|Ini gambar|alice|example.test/);
});
test("maximum valid video question leaves room for its timestamp prefix",()=>{
  assert.equal(buildVideoFrameAnalysisPlan({...video.input,question:"a".repeat(1000)}).frames.length,2);
  assert.throws(()=>buildVideoFrameAnalysisPlan({...video.input,question:"a".repeat(1001)}),/prompt/);
});
test("megapixel upper-bound quote charges each reference and higher output size",()=>{
  const operation=prepareMultimodalOperation({action:"create_wallpaper",input:{prompt:"Wallpaper contoh",width:1920,height:1080,references:[image,image]}});
  const quote=quoteMediaOperation(operation,tariffs[IMAGE_MODEL]);
  assert.equal(operation.feature,"multi_reference_image_editing");assert.equal(quote.maximumMicroUsd,21000n);
  assert.equal(quote.reservedMicrocredits,42000n);
});
test("media audit reports a clean measured job without claiming invoice verification",async t=>{
  const x=fixture(t);await x.run();const r=await inspectMediaBilling(x.env);
  assert.equal(r.jobs,1);assert.equal(r.reviewRequired,false);assert.equal(r.providerInvoiceVerified,false);
  assert.doesNotMatch(JSON.stringify(r),/alice|job-1|data:image/);
});
test("media audit flags unknown, measured-but-unsettled and partial-frame jobs",async t=>{
  for(const kind of ["unknown","wallet","partial"]){
    const x=fixture(t);
    if(kind==="unknown")await x.run({invokeModel:async()=>{throw Error("timeout")}});
    if(kind==="wallet")await x.run({ledger:{reserve:reserveCredits,finalize:async()=>({ok:false})}});
    if(kind==="partial")await x.run({request:video,invokeModel:async()=>{
      x.sql.prepare("UPDATE verified_plan_payments SET verification_status='refunded'").run();return {answer:"frame"};
    }});
    const r=await inspectMediaBilling(x.env);assert.equal(r.reviewRequired,true);assert.equal(r.held_jobs,1);
    assert.equal(r.incomplete_dispatched_jobs,1);
    if(kind==="unknown")assert.equal(r.unresolved_attempts,1);
  }
});
test("pre-dispatch cancellation and insufficient credit stay clean in media audit",async t=>{
  const x=fixture(t,{balance:1});await x.run();const r=await inspectMediaBilling(x.env);
  assert.equal(r.jobs,1);assert.equal(r.reviewRequired,false);
});
test("journal cannot insert a terminal event without its exact prior dispatch",async t=>{
  const x=fixture(t);const entry={attemptId:"media:missing:0",requestId:"media:missing",provider:"cloudflare-workers-ai",
    model:VISION_MODEL,rateVersion:"synthetic",feature:"image_understanding",kind:"usage_measured",providerCostMicroUsd:1n};
  await assert.rejects(appendMediaUsageEvent(x.env,entry),/dispatch_mismatch/);
  await assert.rejects(appendMediaUsageEvent(x.env,{...entry,providerCostMicroUsd:"1"}),/bigint/);
});
test("tariff is captured before asynchronous authorization and client media input cannot mutate prepared scope",async t=>{
  const x=fixture(t);const prices={[VISION_MODEL]:{...tariffs[VISION_MODEL]}};
  const request={...describe,input:{...describe.input}};
  const pending=x.run({request,tariffs:prices});
  request.input.imageDataUri="invalid";request.action="analyze_video_frames";
  prices[VISION_MODEL].maxJobMicroUsd=1n;
  const r=await pending;assert.equal(r.ok,true);assert.equal(r.feature,"image_understanding");
});
test("bounded provider deadline stops a hanging callback and holds both balances",async t=>{
  const x=fixture(t);let upstreamSignal;
  const r=await x.run({tariffs:{[VISION_MODEL]:{...tariffs[VISION_MODEL],callTimeoutMs:15}},
    invokeModel:async({signal})=>{upstreamSignal=signal;return new Promise(()=>{})}});
  assert.equal(r.reason,"provider_outcome_unknown_reservations_held");assert.equal(upstreamSignal.aborted,true);
  assert.equal(x.events().at(-1).event_kind,"outcome_unknown");assert.equal(x.reservation().status,"reserved");
});
test("late provider completion after timeout cannot debit or return output",async t=>{
  const x=fixture(t);let complete;
  const r=await x.run({tariffs:{[VISION_MODEL]:{...tariffs[VISION_MODEL],callTimeoutMs:15}},
    invokeModel:()=>new Promise(resolve=>{complete=resolve})});
  complete({answer:"Late answer"});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.ok,false);assert.equal(r.outputs,undefined);assert.equal(x.reservation().status,"reserved");
  assert.equal(x.events().filter(e=>e.event_kind==="usage_measured").length,0);
});
test("cancellation during journal acknowledgement never starts a model call",async t=>{
  const x=fixture(t);const controller=new AbortController();
  const r=await x.run({signal:controller.signal,journal:async(env,event)=>{
    const r=await appendMediaUsageEvent(env,event);controller.abort();return r;
  }});
  assert.equal(r.reason,"cancelled_after_dispatch_marker_reservations_held");assert.equal(x.calls(),0);
  assert.equal(x.reservation().status,"reserved");assert.equal(r.modelInvoked,false);
});
test("cancelling an in-flight provider call is an unknown-cost outcome, never a free cancellation",async t=>{
  const x=fixture(t);const controller=new AbortController();
  const r=await x.run({signal:controller.signal,invokeModel:()=>{
    setImmediate(()=>controller.abort());return new Promise(()=>{});
  }});
  assert.equal(r.reason,"provider_outcome_unknown_reservations_held");assert.equal(r.modelInvoked,true);
  assert.equal(x.reservation().status,"reserved");assert.equal(x.budget().status,"reserved");
});
test("native Cloudflare adapter composes with actual D1 finance for vision and image outputs",async t=>{
  const x=fixture(t);let nativeCalls=0;
  const invokeModel=createCloudflareMediaInvoker({AI:{run:async(model)=>{
    nativeCalls++;
    return model===VISION_MODEL?{answer:"Gambar contoh."}:{image:pngDataUri({width:256,height:256}).split(",")[1]};
  }}});
  assert.equal((await x.run({invokeModel})).ok,true);
  const generated=await x.run({invokeModel,request:generate,requestId:"job-image"});
  assert.equal(generated.ok,true);assert.equal(nativeCalls,2);
  assert.equal((await inspectMediaBilling(x.env)).reviewRequired,false);
});
test("provider rejection without an Error object remains an unknown-cost failure",async t=>{
  const x=fixture(t);const r=await x.run({invokeModel:()=>Promise.reject(null)});
  assert.equal(r.reason,"provider_outcome_unknown_reservations_held");
  assert.equal(x.events().at(-1).event_kind,"outcome_unknown");assert.equal(x.reservation().status,"reserved");
});
test("whole-job deadline bounds a hanging meter without releasing uncertain spend",async t=>{
  const x=fixture(t);let complete;
  const r=await x.run({jobTimeoutMs:15,measureUsage:()=>new Promise(resolve=>{complete=resolve})});
  assert.equal(r.reason,"media_job_deadline_exceeded_reservations_held");assert.equal(r.modelInvoked,true);
  complete({});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.reservation().status,"reserved");assert.equal(x.budget().status,"reserved");
  assert.equal(x.events().filter(e=>e.event_kind==="usage_measured").length,0);
});
test("late dispatch-journal acknowledgement after job deadline cannot start the provider",async t=>{
  const x=fixture(t);let complete;
  const r=await x.run({jobTimeoutMs:15,journal:()=>new Promise(resolve=>{complete=resolve})});
  assert.equal(r.reason,"media_job_deadline_exceeded_reservations_held");assert.equal(r.modelInvoked,false);
  complete({ok:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.calls(),0);assert.equal(x.reservation().status,"reserved");
});
test("customer-approved credit ceiling also applies inside the coordinator",async t=>{
  const x=fixture(t);const r=await x.run({maximumMicrocredits:1n});
  assert.equal(r.reason,"customer_credit_ceiling_exceeded");assert.equal(x.calls(),0);
  assert.equal(x.reservation(),undefined);assert.equal(x.budget(),undefined);
});
test("output moderation and its deadline must complete before financial settlement",async t=>{
  const x=fixture(t);const r=await x.run({validateOutput:async()=>({ok:false})});
  assert.equal(r.reason,"media_output_unverified_reservations_held");assert.equal(r.outputs,undefined);
  assert.equal(x.reservation().status,"reserved");assert.equal(x.events().at(-1).event_kind,"usage_measured");
});

// DRAFT ONLY. All payments are fictional entries in disposable SQLite.
// Pro always IS Pro, with inherited Basic + Free features, no mode selector.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1, seedSession } from "./e2e/harness.js";
import {
  PLAN_ORDER,PLAN_FEATURE_LEVELS,tierAllows,featuresForTier,
  resolvePlanAccess,authorizePlanFeature
} from "../src/plan-entitlements.js";
import {runJournaledInferencePrototype} from "../src/stage3-journaled-inference.js";

const BASE="https://borai.test";
const NOW=Math.floor(Date.now()/1000);
function setup(t,{enabled=true}={}){
  const db=createD1();t.after(()=>db.sqlite.close());
  const alice=seedSession(db,{id:"alice-test",email:"alice@example.test"});
  const bob=seedSession(db,{id:"bob-test",email:"bob@example.test"});
  const env={DB:db,...(enabled?{PLAN_ENTITLEMENTS_ENABLED:"true",PAID_INFERENCE_ENABLED:"true"}:{})};
  const request=async (path,method="GET",body=null,cookie=alice,origin=BASE)=>{
    const headers={};
    if(cookie!==null)headers.Cookie="__Host-borai_session="+cookie;
    if(method!=="GET")headers.Origin=origin;
    if(body!==null)headers["Content-Type"]="application/json";
    const res=await worker.fetch(new Request(BASE+path,{
      method,headers,body:body===null?undefined:JSON.stringify(body)
    }),env);
    return {status:res.status,data:await res.json(),headers:res.headers};
  };
  const paid=({userId="alice-test",tier="basic",status="active",
    sourceStatus="verified_paid",endAt=NOW+3600,startAt=NOW-60,
    verifiedAt=NOW-80,orderId="verified-order-1"}={})=>{
    db.sqlite.prepare("INSERT INTO verified_plan_payments "+
      "(order_id,user_id,purchased_tier,verification_status,verified_at,updated_at) "+
      "VALUES (?,?,?,?,?,?)").run(orderId,userId,tier,sourceStatus,verifiedAt,NOW+200);
    db.sqlite.prepare("INSERT INTO plan_entitlements "+
      "(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) "+
      "VALUES (?,?,?,?,?,?,?)").run(userId,tier,orderId,status,startAt,endAt,NOW);
  };
  const count=name=>db.sqlite.prepare("SELECT COUNT(*) n FROM "+name).get().n;
  return {db,env,alice,bob,request,paid,count};
}
test("Free ⊂ Basic ⊂ Pro; no selectable lower mode; feature gates follow status",()=>{
  assert.deepEqual(PLAN_ORDER,["free","basic","pro"]);
  assert.equal(PLAN_FEATURE_LEVELS.multi_agent,"free");
  assert.equal(tierAllows("free","chat"),true);
  assert.equal(tierAllows("free","basic_paid_credits"),false);
  assert.equal(tierAllows("basic","chat"),true);
  assert.equal(tierAllows("basic","image_generation"),true);
  assert.equal(tierAllows("basic","video_frame_analysis"),false);
  assert.equal(tierAllows("basic","pro_credit_capacity"),false);
  assert.equal(tierAllows("pro","image_generation"),true);
  assert.equal(tierAllows("pro","advanced_video_analysis"),true);
  assert.equal(tierAllows("pro","pro_credit_capacity"),true);
  assert.ok(featuresForTier("pro").length>featuresForTier("basic").length);
  assert.throws(()=>tierAllows("pro","unknown"),/Unknown protected feature/);
  assert.equal(tierAllows("god","chat"),false);
});
test("the default deployment and guests stay Free; no user-tier selection endpoint",async t=>{
  const x=setup(t,{enabled:false});
  assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
  assert.equal((await x.request("/api/plan","GET",null,null)).data.plan.plan,"free");
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,404);
  assert.equal(x.count("verified_plan_payments"),0);
  assert.equal(x.count("plan_entitlements"),0);
});
test("Free account remains Free without authentic paid proof",async t=>{
  const x=setup(t);
  const r=await x.request("/api/plan");
  assert.equal(r.status,200);assert.equal(r.data.plan.plan,"free");
  assert.equal(r.data.plan.paidTier,null);
  assert.equal(r.headers.get("Cache-Control"),"no-store");
  assert.equal((await x.request("/api/plan/select","POST",{tier:"basic"})).status,404);
  assert.equal((await authorizePlanFeature(x.env,"alice-test","image_generation")).allowed,false);
});
test("Basic subscriber is Basic automatically; retains Free but cannot use Pro",async t=>{
  const x=setup(t);x.paid({tier:"basic"});
  const plan=(await x.request("/api/plan")).data.plan;
  assert.equal(plan.plan,"basic");
  assert.equal(plan.effectiveTier,"basic");
  assert.equal(plan.paidTier,"basic");
  assert.equal(plan.expiresAt,NOW+3600);
  assert.equal(plan.recheckAfterSeconds,60);
  assert.ok(plan.accessibleFeatures.includes("multi_agent"));
  assert.ok(plan.accessibleFeatures.includes("image_understanding"));
  assert.ok(!plan.accessibleFeatures.includes("advanced_video_analysis"));
  assert.equal((await authorizePlanFeature(x.env,"alice-test","basic_paid_credits")).allowed,true);
  assert.equal((await authorizePlanFeature(x.env,"alice-test","pro_credit_capacity")).allowed,false);
  assert.equal(x.count("plan_entitlements"),1);
});
test("Pro subscriber is ALWAYS Pro, inherits Basic+Free and cannot switch app mode",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  for(let i=0;i<3;i++){
    const plan=(await x.request("/api/plan")).data.plan;
    assert.equal(plan.plan,"pro");
    for(const f of ["chat","specialist_agents","image_generation","image_editing","advanced_video_analysis"])
      assert.ok(plan.accessibleFeatures.includes(f),f);
    assert.equal((await authorizePlanFeature(x.env,"alice-test","basic_paid_credits")).allowed,true);
    assert.equal((await authorizePlanFeature(x.env,"alice-test","pro_credit_capacity")).allowed,true);
  }
  for(const attempted of ["free","basic","pro"])
    assert.equal((await x.request("/api/plan/select","POST",{tier:attempted})).status,404);
  assert.equal((await x.request("/api/plan")).data.plan.plan,"pro");
  assert.equal(x.count("verified_plan_payments"),1);
  assert.equal(x.count("plan_entitlements"),1);
});
for(const status of ["refunded","chargeback","revoked"]){
  test("server payment "+status+" immediately falls back from Pro to Free",async t=>{
    const x=setup(t);x.paid({tier:"pro"});
    assert.equal((await x.request("/api/plan")).data.plan.plan,"pro");
    x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status=? WHERE order_id='verified-order-1'").run(status);
    assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
    assert.equal((await authorizePlanFeature(x.env,"alice-test","pro_credit_capacity")).allowed,false);
  });
}
for(const status of ["pending","past_due","cancelled","revoked"]){
  test("subscription state "+status+" cannot confer Basic or Pro",async t=>{
    const x=setup(t);x.paid({tier:"basic",status});
    assert.equal((await resolvePlanAccess(x.env,"alice-test")).plan,"free");
    assert.equal((await authorizePlanFeature(x.env,"alice-test","image_understanding")).allowed,false);
  });
}
test("expired, future and unverified payment proofs all return Free",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  x.db.sqlite.prepare("UPDATE plan_entitlements SET ends_at=? WHERE user_id='alice-test'").run(NOW-1);
  assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
  x.db.sqlite.prepare("UPDATE plan_entitlements SET starts_at=?,ends_at=? WHERE user_id='alice-test'")
    .run(NOW+300,NOW+1000);
  assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
  x.db.sqlite.prepare("UPDATE plan_entitlements SET starts_at=?,ends_at=? WHERE user_id='alice-test'")
    .run(NOW-300,NOW+1000);
  x.db.sqlite.prepare("UPDATE verified_plan_payments SET verified_at=?,updated_at=? WHERE order_id='verified-order-1'").run(NOW+100,NOW+100);
  assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
});
test("tenant B's Pro subscription never grants tenant A any Pro feature",async t=>{
  const x=setup(t);x.paid({userId:"bob-test",tier:"pro",orderId:"bob-order"});
  assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
  assert.equal((await x.request("/api/plan","GET",null,x.bob)).data.plan.plan,"pro");
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro",userId:"bob-test"})).status,404);
});
test("invalid and missing D1 tables fail closed",async t=>{
  const x=setup(t);x.db.sqlite.exec("DROP TABLE verified_plan_payments");
  const r=await x.request("/api/plan");
  assert.equal(r.status,503);
  assert.equal(r.data.code,"plan_verification_unavailable");
});
test("unknown user and reference reuse cannot cross-assign a verified payment",t=>{
  const x=setup(t);x.paid({tier:"basic"});
  assert.throws(()=>x.db.sqlite.prepare(
    "INSERT INTO plan_entitlements(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).run("bob-test","pro","verified-order-1","active",NOW-10,NOW+900,NOW),/UNIQUE|FOREIGN KEY/);
});
test("account erasure cascades plan entitlement and temporary eligibility proof",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  x.db.sqlite.prepare("DELETE FROM users WHERE id='alice-test'").run();
  assert.equal(x.count("plan_entitlements"),0);
  assert.equal(x.count("verified_plan_payments"),0);
  assert.equal((await x.request("/api/plan")).data.plan.plan,"free");
});
test("client-supplied tier, plan or credits cannot self-promote during chat",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  for(const fields of [{tier:"pro"},{plan:"pro"},{paidTier:"pro"},{credits:999999}]){
    const r=await x.request("/api/chat","POST",{message:"Halo",...fields});
    assert.equal(r.status,400);
    assert.equal(r.data.code,"client_tier_override_rejected");
  }
  assert.equal((await x.request("/api/plan")).data.plan.plan,"pro");
});
test("paid inference denies Free and Basic access BEFORE provider budget reservation",async t=>{
  const x=setup(t);
  const trace=[];
  const policy={
    approved:true,provider:"cloudflare-workers-ai",model:"@cf/synthetic",
    version:"rate-v1",requiredPlan:"pro",inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  let n=0;
  const run=()=>runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"req-"+(++n),
    attemptId:"attempt-"+n,tariff:policy,maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:{
      reserve:async()=>{trace.push("reserve");return {ok:false}},
      settle:async()=>{throw Error("not called");}
    },
    ledger:{
      reserve:async()=>{throw Error("not called");},
      finalize:async()=>{throw Error("not called");}
    },
    invokeModel:async()=>{trace.push("AI");throw Error("not called")}
  });
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
  x.paid({tier:"basic"});
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
  x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status='refunded' WHERE order_id='verified-order-1'").run();
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
});
test("Pro automatic entitlement passes plan check before budget; revocation stops it",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  const trace=[];
  const tariff={
    approved:true,provider:"cloudflare-workers-ai",model:"@cf/synthetic",
    version:"rate-v1",requiredPlan:"pro",inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  let i=0;
  const run=()=>runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"r-"+(++i),attemptId:"a-"+i,
    tariff,maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:{
      reserve:async()=>{trace.push("reserve");return {ok:false};},
      settle:async()=>{throw Error("no")}
    },
    ledger:{reserve:async()=>{throw Error("no")},finalize:async()=>{throw Error("no")}},
    invokeModel:async()=>{throw Error("no")}
  });
  assert.equal((await run()).reason,"provider_budget_reservation_rejected");
  assert.deepEqual(trace,["reserve"]);
  x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status='refunded'").run();
  trace.length=0;
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
});

test("Stage 3 holds both financial reservations when Pro is refunded during provider execution",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  const trace=[];
  const tariff={
    approved:true,provider:"cloudflare-workers-ai",model:"@cf/synthetic",
    version:"revocation-v1",requiredPlan:"pro",inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  const result=await runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"revoked-during-model",attemptId:"revoked-attempt",
    tariff,maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:{
      reserve:async()=>{trace.push("budget:reserve");return {ok:true};},
      settle:async()=>{trace.push("budget:settle");return {ok:true};}
    },
    ledger:{
      reserve:async()=>{trace.push("wallet:reserve");return {ok:true};},
      finalize:async()=>{trace.push("wallet:finalize");return {ok:true};}
    },
    journal:async(_env,event)=>{trace.push("journal:"+event.kind);return {ok:true};},
    invokeModel:async()=>{
      trace.push("model:invoke");
      x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status='refunded' WHERE order_id='verified-order-1'").run();
      return {answer:"must not be delivered",usage:{prompt_tokens:100,completion_tokens:10}};
    }
  });
  assert.deepEqual(result,{ok:false,reason:"paid_plan_revoked_reservations_held",modelInvoked:true});
  assert.deepEqual(trace,["budget:reserve","wallet:reserve","journal:dispatched",
    "model:invoke","journal:usage_measured"]);
  assert.equal((await resolvePlanAccess(x.env,"alice-test")).plan,"free");
});
test("Stage 3 never releases output if entitlement is revoked while credit settlement commits",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  const trace=[];
  const tariff={
    approved:true,provider:"cloudflare-workers-ai",model:"@cf/synthetic",
    version:"revocation-v1",requiredPlan:"pro",inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  const result=await runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"revoked-at-settlement",attemptId:"settlement-attempt",
    tariff,maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:{
      reserve:async()=>{trace.push("budget:reserve");return {ok:true};},
      settle:async()=>{trace.push("budget:settle");return {ok:true};}
    },
    ledger:{
      reserve:async()=>{trace.push("wallet:reserve");return {ok:true};},
      finalize:async()=>{
        trace.push("wallet:finalize");
        x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status='refunded' WHERE order_id='verified-order-1'").run();
        return {ok:true};
      }
    },
    journal:async(_env,event)=>{trace.push("journal:"+event.kind);return {ok:true};},
    invokeModel:async()=>({answer:"must not be delivered",usage:{prompt_tokens:100,completion_tokens:10}})
  });
  assert.deepEqual(result,{ok:false,reason:"paid_plan_revoked_after_settlement",modelInvoked:true});
  assert.deepEqual(trace,["budget:reserve","wallet:reserve","journal:dispatched",
    "journal:usage_measured","budget:settle","wallet:finalize"]);
  assert.equal((await resolvePlanAccess(x.env,"alice-test")).plan,"free");
});
test("Stage 3 disabling plan verification during model execution cannot bypass recheck",async t=>{
  const x=setup(t);x.paid({tier:"basic"});
  const tariff={
    approved:true,provider:"workers-ai",model:"@cf/synthetic",
    version:"revocation-v1",requiredPlan:"basic",inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  let settlements=0;
  const result=await runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"flag-revoked",attemptId:"flag-attempt",
    tariff,maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:{reserve:async()=>({ok:true}),settle:async()=>{settlements++;return {ok:true};}},
    ledger:{reserve:async()=>({ok:true}),finalize:async()=>{settlements++;return {ok:true};}},
    journal:async()=>({ok:true}),
    invokeModel:async()=>{
      delete x.env.PLAN_ENTITLEMENTS_ENABLED;
      return {answer:"withheld",usage:{prompt_tokens:100,completion_tokens:10}};
    }
  });
  assert.equal(result.reason,"paid_plan_revoked_reservations_held");
  assert.equal(result.ok,false);
  assert.equal(settlements,0);
});

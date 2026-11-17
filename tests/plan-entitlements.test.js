// All plan checks are against actual UNAPPLIED D1 SQL in disposable local
// SQLite. Verified-payment evidence below is FICTIONAL test data only.
// No real Midtrans, Workers AI, payment, credit issuance or live D1 call.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1, seedSession } from "./e2e/harness.js";
import { runJournaledInferencePrototype } from "../src/stage3-journaled-inference.js";
import {
  PLAN_ORDER, PLAN_FEATURE_LEVELS, tierAllows, featuresForTier,
  resolvePlanAccess, selectAccountPlan, authorizePlanFeature
} from "../src/plan-entitlements.js";

const BASE="https://borai.test";
const NOW=Math.floor(Date.now()/1000);
function setup(t,{enabled=true}={}){
  const db=createD1();
  t.after(()=>db.sqlite.close());
  const alice=seedSession(db,{id:"alice-test",email:"alice@example.test"});
  const bob=seedSession(db,{id:"bob-test",email:"bob@example.test"});
  const env={DB:db,...(enabled?{PLAN_ENTITLEMENTS_ENABLED:"true"}:{})};
  const request=async (path,method="GET",body=null,cookie=alice,origin=BASE)=>{
    const headers={};
    if(cookie!==null)headers.Cookie="__Host-borai_session="+cookie;
    if(method!=="GET")headers.Origin=origin;
    if(body!==null){headers["Content-Type"]="application/json";}
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
      "VALUES (?,?,?,?,?,?)").run(orderId,userId,tier,sourceStatus,verifiedAt,NOW);
    db.sqlite.prepare("INSERT INTO plan_entitlements "+
      "(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) "+
      "VALUES (?,?,?,?,?,?,?)").run(userId,tier,orderId,status,startAt,endAt,NOW);
  };
  const count=(name)=>db.sqlite.prepare("SELECT COUNT(*) AS n FROM "+name).get().n;
  return {db,env,alice,bob,request,paid,count};
}
test("hierarchy includes Free in Basic and both Free+Basic in Pro; nobody inherits upward",()=>{
  assert.deepEqual(PLAN_ORDER,["free","basic","pro"]);
  assert.equal(PLAN_FEATURE_LEVELS.multi_agent,"free");
  assert.equal(tierAllows("free","chat"),true);
  assert.equal(tierAllows("free","basic_paid_credits"),false);
  assert.equal(tierAllows("free","pro_credit_capacity"),false);
  assert.equal(tierAllows("basic","chat"),true);
  assert.equal(tierAllows("basic","basic_paid_credits"),true);
  assert.equal(tierAllows("basic","pro_credit_capacity"),false);
  assert.equal(tierAllows("pro","chat"),true);
  assert.equal(tierAllows("pro","basic_paid_credits"),true);
  assert.equal(tierAllows("pro","pro_credit_capacity"),true);
  assert.equal(featuresForTier("basic").includes("pro_rollover_eligibility"),false);
  assert.equal(featuresForTier("pro").includes("pro_rollover_eligibility"),true);
  assert.throws(()=>tierAllows("pro","invented_secret"),/Unknown protected feature/);
  assert.equal(tierAllows("god","chat"),false);
});
test("default deployment leaves Free unchanged and cannot self-promote without billing rollout",async t=>{
  const x=setup(t,{enabled:false});
  const guest=await x.request("/api/plan","GET",null,null);
  assert.equal(guest.status,200);
  assert.equal(guest.data.plan.effectiveTier,"free");
  assert.equal(guest.data.plan.planSelectionEnabled,false);
  const signed=await x.request("/api/plan");
  assert.equal(signed.data.plan.effectiveTier,"free");
  assert.deepEqual(signed.data.plan.availableTiers,["free"]);
  const upgrade=await x.request("/api/plan/select","POST",{tier:"pro"});
  assert.equal(upgrade.status,503);
  assert.equal(x.count("verified_plan_payments"),0);
  assert.equal(x.count("plan_entitlements"),0);
});
test("missing verified payment allows Free but denies Basic/Pro",async t=>{
  const x=setup(t);
  const read=await x.request("/api/plan");
  assert.equal(read.status,200);
  assert.equal(read.data.plan.effectiveTier,"free");
  assert.equal(read.data.plan.paidTier,null);
  assert.deepEqual(read.data.plan.availableTiers,["free"]);
  for(const tier of ["basic","pro"]){
    const denied=await x.request("/api/plan/select","POST",{tier});
    assert.equal(denied.status,403);
    assert.equal(denied.data.code,"verified_plan_required");
  }
  const free=await x.request("/api/plan/select","POST",{tier:"free"});
  assert.equal(free.status,200);
  assert.equal(free.data.plan.effectiveTier,"free");
  assert.equal(x.count("plan_selections"),1);
  assert.equal(x.count("plan_entitlements"),0);
});
test("Basic buyer inherits Free but cannot select or consume Pro capabilities",async t=>{
  const x=setup(t);x.paid({tier:"basic"});
  assert.equal((await x.request("/api/plan")).data.plan.effectiveTier,"free");
  const chosen=await x.request("/api/plan/select","POST",{tier:"basic"});
  assert.equal(chosen.status,200);
  assert.equal(chosen.data.plan.paidTier,"basic");
  assert.equal(chosen.data.plan.effectiveTier,"basic");
  assert.deepEqual(chosen.data.plan.availableTiers,["free","basic"]);
  assert.ok(chosen.data.plan.accessibleFeatures.includes("multi_agent"));
  assert.ok(chosen.data.plan.accessibleFeatures.includes("basic_paid_credits"));
  assert.ok(!chosen.data.plan.accessibleFeatures.includes("pro_credit_capacity"));
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,403);
  assert.equal((await authorizePlanFeature(x.env,"alice-test","pro_credit_capacity")).allowed,false);
  assert.equal((await authorizePlanFeature(x.env,"alice-test","basic_paid_credits")).allowed,true);
  assert.equal(x.count("verified_plan_payments"),1);
  assert.equal(x.count("plan_entitlements"),1);
});
test("Pro may choose Pro, Basic or Free without stacking grants or losing subscription",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  for(const tier of ["pro","basic","free","pro"]){
    const selected=await x.request("/api/plan/select","POST",{tier});
    assert.equal(selected.status,200);
    assert.equal(selected.data.plan.effectiveTier,tier);
    assert.equal(selected.data.plan.paidTier,"pro");
    assert.deepEqual(selected.data.plan.availableTiers,["free","basic","pro"]);
    const pro=await authorizePlanFeature(x.env,"alice-test","pro_credit_capacity");
    assert.equal(pro.allowed,tier==="pro");
    const basic=await authorizePlanFeature(x.env,"alice-test","basic_paid_credits");
    assert.equal(basic.allowed,tier==="pro"||tier==="basic");
  }
  assert.equal(x.count("verified_plan_payments"),1);
  assert.equal(x.count("plan_entitlements"),1);
  assert.equal(x.count("plan_selections"),1);
});
for(const status of ["refunded","chargeback","revoked"]){
  test("source "+status+" immediately revokes paid access despite stale selected Pro",async t=>{
    const x=setup(t);x.paid({tier:"pro"});
    assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,200);
    x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status=? WHERE order_id='verified-order-1'").run(status);
    const read=await x.request("/api/plan");
    assert.equal(read.status,200);
    assert.equal(read.data.plan.effectiveTier,"free");
    assert.equal(read.data.plan.paidTier,null);
    assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,403);
  });
}
for(const status of ["pending","past_due","cancelled","revoked"]){
  test("subscription "+status+" never authorizes paid mode",async t=>{
    const x=setup(t);x.paid({tier:"basic",status});
    assert.equal((await x.request("/api/plan/select","POST",{tier:"basic"})).status,403);
    assert.equal((await resolvePlanAccess(x.env,"alice-test")).effectiveTier,"free");
  });
}
test("expired, future and unverified source proof each fall back to Free",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,200);
  x.db.sqlite.prepare("UPDATE plan_entitlements SET ends_at=? WHERE user_id='alice-test'").run(NOW-1);
  assert.equal((await x.request("/api/plan")).data.plan.effectiveTier,"free");
  x.db.sqlite.prepare("UPDATE plan_entitlements SET starts_at=?,ends_at=? WHERE user_id='alice-test'")
    .run(NOW+300,NOW+1000);
  assert.equal((await x.request("/api/plan")).data.plan.effectiveTier,"free");
  x.db.sqlite.prepare("UPDATE plan_entitlements SET starts_at=?,ends_at=? WHERE user_id='alice-test'")
    .run(NOW-300,NOW+1000);
  x.db.sqlite.prepare("UPDATE verified_plan_payments SET verified_at=?,updated_at=? WHERE order_id='verified-order-1'").run(NOW+100,NOW+100);
  assert.equal((await x.request("/api/plan")).data.plan.effectiveTier,"free");
});
test("account separation: client cannot promote a different user by injecting userId",async t=>{
  const x=setup(t);x.paid({tier:"pro",userId:"bob-test",orderId:"bob-proof"});
  const fake=await x.request("/api/plan/select","POST",{tier:"pro",userId:"bob-test"});
  assert.equal(fake.status,400);
  const aliceTry=await x.request("/api/plan/select","POST",{tier:"pro"});
  assert.equal(aliceTry.status,403);
  const bob=await x.request("/api/plan/select","POST",{tier:"pro"},x.bob);
  assert.equal(bob.status,200);
  assert.equal(bob.data.plan.effectiveTier,"pro");
  assert.equal((await x.request("/api/plan")).data.plan.effectiveTier,"free");
});
test("cross-origin, guest and invalid-tier writes fail without touching paid proof",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"},null)).status,401);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"},x.alice,"https://evil.test")).status,403);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"enterprise"})).status,409);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro",source:"payment"})).status,400);
  assert.equal((await x.request("/api/plan/select","POST",{userId:"bob-test",tier:"pro"})).status,400);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro",priceUsd:0})).status,400);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro",verified:true})).status,400);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"free"})).status,200);
  assert.equal(x.count("verified_plan_payments"),1);
});
test("paid entitlement lookups fail closed when D1 schema is missing or malformed",async t=>{
  const x=setup(t);x.db.sqlite.exec("DROP TABLE plan_selections");
  const read=await x.request("/api/plan");
  assert.equal(read.status,503);
  assert.equal(read.data.code,"plan_verification_unavailable");
  const write=await x.request("/api/plan/select","POST",{tier:"pro"});
  assert.equal(write.status,503);
});
test("single verified order cannot be assigned to another account or plan",t=>{
  const x=setup(t);x.paid({tier:"basic"});
  assert.throws(()=>x.db.sqlite.prepare(
    "INSERT INTO plan_entitlements(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).run("bob-test","pro","verified-order-1","active",NOW-20,NOW+3600,NOW),/UNIQUE|FOREIGN KEY/);
});

test("plan gate rejects Free/Basic abuse BEFORE any credit reserve or AI provider call",async t=>{
  const x=setup(t);
  const trace=[];
  const policy={
    approved:true,provider:"cloudflare-workers-ai",model:"@cf/llama-test",
    version:"test-rate-v1",requiredPlan:"basic",
    inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,
    creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  const fakeProvider={
    async reserve(){trace.push("provider-reserve");return{ok:true}},
    async settle(){trace.push("provider-settle");return{ok:true}}
  };
  const fakeWallet={
    async reserve(){trace.push("wallet-reserve");return{ok:false}},
    async finalize(){trace.push("wallet-finalize");return{ok:true}}
  };
  const invokeModel=async()=>{trace.push("AI-CALL");return{usage:{prompt_tokens:1000,completion_tokens:100}}};
  let seq=0;
  const run=tariff=>runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"fake-paid-req-"+(++seq),
    attemptId:"fake-paid-attempt-"+seq,tariff,
    maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:fakeProvider,ledger:fakeWallet,invokeModel
  });
  assert.equal((await run(policy)).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
  x.paid({tier:"basic"});
  // Even a verified Basic subscription cannot use paid feature while
  // the customer voluntarily selected Free mode.
  assert.equal((await run(policy)).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"basic"})).status,200);
  assert.equal((await run({...policy,requiredPlan:"pro"})).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
  assert.equal((await run(policy)).reason,"credit_reservation_rejected");
  assert.deepEqual(trace,["provider-reserve","wallet-reserve","provider-settle"]);
  assert.equal(trace.includes("AI-CALL"),false);
  x.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status='refunded' WHERE order_id='verified-order-1'").run();
  trace.length=0;
  assert.equal((await run(policy)).reason,"paid_plan_entitlement_rejected");
  assert.deepEqual(trace,[]);
});

test("Pro can access Basic + Pro protected capacity only while Pro mode is selected",async t=>{
  const x=setup(t);
  x.paid({tier:"pro"});
  const budgetCalls=[];
  const policy={
    approved:true,provider:"cloudflare-workers-ai",model:"@cf/test",
    version:"test-v1",requiredPlan:"pro",
    inputRateMicroUsdPerMillion:293000n,
    outputRateMicroUsdPerMillion:2253000n,
    creditNumerator:1n,creditDenominator:1n,
    maxCallMicroUsd:9000n,maxCallMicrocredits:9000n
  };
  let seq=0;
  const run=async()=>runJournaledInferencePrototype({
    env:x.env,userId:"alice-test",requestId:"synthetic-"+(++seq),
    attemptId:"attempt-"+seq,tariff:policy,
    maxInputTokens:1000,maxOutputTokens:100,
    providerBudget:{
      async reserve(){budgetCalls.push("reserved");return {ok:false}},
      async settle(){throw Error("not reached")}
    },
    ledger:{async reserve(){throw Error("not reached")},async finalize(){throw Error("not reached")}},
    invokeModel:async()=>{throw Error("paid AI must remain uncalled")}
  });
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
  assert.equal((await x.request("/api/plan/select","POST",{tier:"basic"})).status,200);
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,200);
  assert.equal((await run()).reason,"provider_budget_reservation_rejected");
  assert.deepEqual(budgetCalls,["reserved"]);
  assert.equal((await x.request("/api/plan/select","POST",{tier:"free"})).status,200);
  assert.equal((await run()).reason,"paid_plan_entitlement_rejected");
});

test("guest, unknown order and fake plan selection never expose paid inference",async t=>{
  const x=setup(t);
  await assert.rejects(
    resolvePlanAccess({...x.env,DB:undefined},"alice-test"),
    /database unavailable/
  );
  assert.equal((await authorizePlanFeature(x.env,null,"basic_paid_credits")).allowed,false);
  assert.equal((await x.request("/api/plan")).headers.get("Cache-Control"),"no-store");
});

test("account deletion cascades temporary plan selection and payment eligibility records",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  assert.equal((await x.request("/api/plan/select","POST",{tier:"pro"})).status,200);
  x.db.sqlite.prepare("DELETE FROM users WHERE id='alice-test'").run();
  assert.equal(x.count("plan_selections"),0);
  assert.equal(x.count("plan_entitlements"),0);
  assert.equal(x.count("verified_plan_payments"),0);
  assert.equal((await x.request("/api/plan","GET",null,x.alice)).data.plan.effectiveTier,"free");
});

test("chat payload cannot forge paid plan tier or mint extra credits",async t=>{
  const x=setup(t);x.paid({tier:"pro"});
  for(const extra of [{plan:"pro"},{tier:"pro"},{paidTier:"pro"},{credits:1000000}]){
    const response=await x.request("/api/chat","POST",{message:"Halo",agent:"coordinator",...extra});
    assert.equal(response.status,400);
    assert.equal(response.data.code,"client_tier_override_rejected");
  }
  assert.equal(x.count("plan_selections"),0);
  assert.equal(x.count("verified_plan_payments"),1);
});

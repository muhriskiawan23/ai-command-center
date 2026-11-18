import test from "node:test";
import assert from "node:assert/strict";
import { startHarness,seedSession } from "./e2e/harness.js";
const USER={id:"browser-agent-owner",email:"agent@example.test",name:"Agent Tester"};
const URL="https://demo.playwright.dev/todomvc/";
const readPlan={url:URL,steps:[]};
const clickPlan={url:URL,steps:[{type:"click",target:{by:"role",role:"button",name:"Clear completed"}}]};
function headers(app,token){return {"Content-Type":"application/json",Origin:app.url,Cookie:"__Host-borai_session="+token};}
async function call(app,token,path,body){
 const response=await fetch(app.url+path,{method:"POST",headers:headers(app,token),body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
function fakeEnv(){
 const observed=[];
 const binding={async fetch(_url,init){
  const sent=JSON.parse(init.body);observed.push({sent,token:init.headers.Authorization});
  return Response.json({ok:true,host:"demo.playwright.dev",url:sent.url,title:"TodoMVC",
    text:"What needs to be done?",elements:[{by:"placeholder",role:"textbox",name:"What needs to be done?"}],
    stepsExecuted:sent.steps.length,truncated:false});
 }};
 return {observed,BROWSER_AGENT:binding,BROWSER_AGENT_ENABLED:"true",
  BROWSER_AGENT_ALLOWED_HOSTS:"demo.playwright.dev",BROWSER_AGENT_TOKEN:"t".repeat(40),
  BROWSER_APPROVAL_SECRET:"s".repeat(40),BROWSER_AGENT_DAILY_USER_JOBS:"2",
  BROWSER_AGENT_DAILY_GLOBAL_JOBS:"10"};
}
test("browser feature is dark, non-billable and inaccessible without private service binding",async()=>{
 const app=await startHarness();try{
  const res=await call(app,"fake","/api/browser/execute",{plan:readPlan});
  assert.equal(res.status,503);
  assert.equal(res.body.code,"browser_not_ready");
  assert.equal(app.aiCalls.length,0);
 }finally{await app.close();}
});
test("signed-in browser inspect requires feature gate, exact HTTPS host and D1 quota",async()=>{
 const extra=fakeEnv();const app=await startHarness({extraEnv:extra});
 try{
  const token=seedSession(app.db,USER);
  const plan=await call(app,token,"/api/browser/plan",{plan:readPlan});
  assert.equal(plan.status,200);
  assert.equal(plan.body.requiresConfirmation,false);
  assert.equal(extra.observed.length,0);
  const result=await call(app,token,"/api/browser/execute",{plan:plan.body.plan});
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.title,"TodoMVC");
  assert.equal(extra.observed.length,1);
  assert.equal(extra.observed[0].token,"Bearer "+"t".repeat(40));
  assert.ok(!JSON.stringify(result.body).includes("tttttt"));
  const second=await call(app,token,"/api/browser/execute",{plan:readPlan});
  assert.equal(second.status,200);
  const third=await call(app,token,"/api/browser/execute",{plan:readPlan});
  assert.equal(third.status,429);
  assert.equal(extra.observed.length,2);
  const invalid=await call(app,token,"/api/browser/plan",{plan:{url:"http://127.0.0.1/admin",steps:[]}});
  assert.equal(invalid.status,400);
 }finally{await app.close();}
});
test("browser click requires consent for exact plan, one-time token, same signed-in user and exact origin",async()=>{
 const extra=fakeEnv();const app=await startHarness({extraEnv:extra});
 try{
  const token=seedSession(app.db,USER);
  const noConsent=await call(app,token,"/api/browser/execute",{plan:clickPlan});
  assert.equal(noConsent.status,403);
  const agreed=await call(app,token,"/api/browser/plan",{plan:clickPlan});
  assert.equal(agreed.status,200,JSON.stringify(agreed.body));
  assert.equal(agreed.body.requiresConfirmation,true);
  assert.ok(agreed.body.approvalToken);
  const altered=await call(app,token,"/api/browser/execute",{plan:{...clickPlan,steps:[{type:"click",target:{by:"role",role:"button",name:"Add"}}]},approvalToken:agreed.body.approvalToken});
  assert.equal(altered.status,403);
  const done=await call(app,token,"/api/browser/execute",{plan:agreed.body.plan,approvalToken:agreed.body.approvalToken});
  assert.equal(done.status,200,JSON.stringify(done.body));
  assert.equal(done.body.stepsExecuted,1);
  const replay=await call(app,token,"/api/browser/execute",{plan:clickPlan,approvalToken:agreed.body.approvalToken});
  assert.equal(replay.status,409);
  const guest=await call(app,"guest","/api/browser/plan",{plan:readPlan});
  assert.equal(guest.status,401);
  const forbidden=await fetch(app.url+"/api/browser/plan",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://evil.example",Cookie:"__Host-borai_session="+token},body:JSON.stringify({plan:readPlan})});
  assert.equal(forbidden.status,403);
 }finally{await app.close();}
});


test("model-guided browser step suggestion charges one AI unit but still cannot execute without confirmation",async()=>{
 const extra=fakeEnv();const app=await startHarness({extraEnv:extra});
 const usedModels=[];
 app.env.AI.run=async(model,params)=>{
  usedModels.push(model);
  assert.match(params.messages[0].content,/untrusted DATA/i);
  return {response:'{"index":0,"action":"click"}'};
 };
 try{
  const token=seedSession(app.db,USER);
  const page={url:URL,text:"TodoMVC",elements:[{by:"role",role:"button",name:"Clear completed"}]};
  const suggested=await call(app,token,"/api/browser/suggest",{instruction:"Klik tombol untuk membersihkan item selesai",page});
  assert.equal(suggested.status,200,JSON.stringify(suggested.body));
  assert.equal(suggested.body.suggestion.type,"click");
  assert.equal(suggested.body.approvalToken,undefined);
  assert.deepEqual(usedModels,["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
  assert.equal(extra.observed.length,0);
  const quota=app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE day = ? AND subject = ?")
    .get(new Date().toISOString().slice(0,10),"user:"+USER.id);
  assert.equal(quota.units,1);
  const direct=await call(app,token,"/api/browser/execute",{plan:clickPlan});
  assert.equal(direct.status,403);
 }finally{await app.close();}
});

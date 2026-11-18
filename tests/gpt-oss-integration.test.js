import test from "node:test";
import assert from "node:assert/strict";
import { startHarness, seedSession } from "./e2e/harness.js";
import { GPT_OSS_MODEL_ID } from "../src/gpt-oss.js";

const LLAMA = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const USER = {id:"reasoning-canary-test",email:"reasoning@example.test",name:"Tester"};
async function message(app, text="Halo BOR AI"){
 const token=seedSession(app.db,USER);
 const response=await fetch(app.url+"/api/chat",{
  method:"POST",
  headers:{"Content-Type":"application/json",Origin:app.url,Cookie:"__Host-borai_session="+token},
  body:JSON.stringify({message:text,language:"id"})
 });
 return {status:response.status,body:await response.json()};
}

test("authenticated Worker canary selects GPT-OSS and reserves atomic D1 USD budget before inference",async()=>{
 const app=await startHarness({extraEnv:{BOR_GPT_OSS_ENABLED:"true",BOR_GPT_OSS_DAILY_USD_LIMIT:"0.25"}});
 try {
  const {status,body}=await message(app);
  assert.equal(status,200,JSON.stringify(body));
  assert.equal(body.model,GPT_OSS_MODEL_ID);
  assert.deepEqual(app.aiModelCalls,[GPT_OSS_MODEL_ID]);
  assert.equal(body.agentModels[0].policyVersion,"gpt-oss-budgeted-canary-v1");
  const row=app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE subject = 'provider:gpt-oss-120b:global:micro-usd'").get();
  assert.ok(Number(row?.units)>0&&Number(row.units)<=250000);
 } finally {await app.close();}
});

test("low global GPT-OSS budget falls back to original Workers AI model",async()=>{
 const app=await startHarness({extraEnv:{BOR_GPT_OSS_ENABLED:"true",BOR_GPT_OSS_DAILY_USD_LIMIT:"0.0001"}});
 try {
  const {status,body}=await message(app);
  assert.equal(status,200,JSON.stringify(body));
  assert.equal(body.model,LLAMA);
  assert.deepEqual(app.aiModelCalls,[LLAMA]);
 } finally {await app.close();}
});

test("GPT-OSS provider error uses Llama fallback without a second paid GPT-OSS call",async()=>{
 const app=await startHarness({extraEnv:{BOR_GPT_OSS_ENABLED:"true",BOR_GPT_OSS_DAILY_USD_LIMIT:"0.25"}});
 const base=app.env.AI.run;
 app.env.AI.run=(model,payload,opts)=>model===GPT_OSS_MODEL_ID?Promise.reject(new Error("synthetic model unavailable")):base(model,payload,opts);
 try {
  const {status,body}=await message(app);
  assert.equal(status,200,JSON.stringify(body));
  assert.equal(body.model,LLAMA);
  assert.deepEqual(app.aiModelCalls,[LLAMA]);
  assert.equal(body.agentModels[0].calls,2);
  const row=app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE subject = 'provider:gpt-oss-120b:global:micro-usd'").get();
  assert.ok(row.units>0);
 } finally {await app.close();}
});

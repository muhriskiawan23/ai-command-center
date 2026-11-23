import test from "node:test";
import assert from "node:assert/strict";
import { seedConversation, seedSession, startHarness } from "./e2e/harness.js";
import { withTextProviderFailover } from "../src/text-provider-failover.js";
import { DEFAULT_MODEL_ID } from "../src/model-gateway.js";

// Zero **additional** provider budget, not a promise of infinite Free quota.
// Runs the actual Worker with SQLite and a fake AI. No Cloudflare, OpenAI,
// Tavily, real customer data, new resources or paid provider calls.
test("Free mode: model quota outage preserves existing account chat and refunds failed usage; retry saves once", async t => {
  const app=await startHarness({extraEnv:{
    BOR_TEXT_BACKUP_ENABLED:"false",
    BOR_TEXT_AI_DAILY_USD_LIMIT:undefined,
    URL_READER_ENABLED:"false",
    TAVILY_EXTRACT_DAILY_URL_LIMIT:"0",
    BOR_IMAGES_ENABLED:"false"
  }});
  t.after(()=>app.close());
  const owner={id:"synthetic-global-free-user",email:"synthetic-global@example.invalid",name:"Synthetic"};
  const token=seedSession(app.db,owner);
  const now=Math.floor(Date.now()/1000);
  const conversationId="synthetic-free-continuity";
  seedConversation(app.db,{id:conversationId,userId:owner.id,title:"Synthetic retained history",
    updatedAt:now,messages:[
      {role:"user",content:"SYNTHETIC_OLD_QUESTION"},
      {role:"assistant",content:"SYNTHETIC_OLD_ANSWER"}
    ]});
  const cookie="__Host-borai_session="+token;
  const headers={"Content-Type":"application/json",Origin:app.url,Cookie:cookie};
  const requestId=crypto.randomUUID();
  const body=JSON.stringify({message:"Simple synthetic capacity test",agent:"coordinator",
    conversationId,requestId,language:"en"});
  const send=()=>fetch(app.url+"/api/chat",{method:"POST",headers,body});
  const count=()=>app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?").get(conversationId).n;
  const units=subject=>app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE subject=?").get(subject)?.units??0;
  let calls=0;
  app.env.AI.run=async()=>{
    calls++;
    throw Object.assign(new Error("synthetic quota failure"),{code:3036,status:429});
  };
  const failure=await send();
  assert.equal(failure.status,502);
  const failureBody=await failure.json();
  assert.equal(failureBody.code,"ai_error");
  assert.equal(failureBody.stage,"ai_generation");
  assert.notEqual(failureBody.saved,true);
  assert.equal(count(),2,"the failed turn must not create a partial pair");
  assert.equal(units("user:"+owner.id),0);
  assert.equal(units("global"),0);
  assert.ok(calls>=1);

  // The app's account/history and low-cost health endpoints are separate from AI.
  const [health,agents,history]=await Promise.all([
    fetch(app.url+"/api/health"),
    fetch(app.url+"/api/agents"),
    fetch(app.url+"/api/conversations/"+conversationId,{headers:{Cookie:cookie}})
  ]);
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  assert.equal(agents.status,200);
  assert.ok((await agents.json()).agents.length>=10);
  assert.equal(history.status,200);
  assert.deepEqual((await history.json()).messages.map(x=>x.content),
    ["SYNTHETIC_OLD_QUESTION","SYNTHETIC_OLD_ANSWER"]);

  // On recovery, the same requestId is safe: the failed call never committed.
  app.env.AI.run=async()=>({response:"SYNTHETIC_RECOVERED_ANSWER. This is an offline fixture only."});
  const success=await send();
  assert.equal(success.status,200);
  const saved=await success.json();
  assert.equal(saved.saved,true);
  assert.equal(saved.conversationId,conversationId);
  assert.equal(count(),4);
  const retry=await send();
  assert.equal(retry.status,200);
  const again=await retry.json();
  assert.equal(again.conversationId,conversationId);
  assert.equal(again.saved,true);
  assert.equal(count(),4,"idempotent retry must not duplicate the recovered turn");
  assert.equal(units("user:"+owner.id),1);
  assert.equal(units("global"),1);
  assert.equal(app.db.sqlite.prepare("PRAGMA foreign_key_check").all().length,0);
});

test("Free mode never contacts paid backup even if a stale backup key remains present", async()=>{
  let calls=0;
  let externalCalls=0;
  const env=withTextProviderFailover({
    BOR_TEXT_BACKUP_ENABLED:"false",
    BOR_TEXT_BACKUP_API_KEY:"SYNTHETIC_DO_NOT_USE",
    BOR_TEXT_BACKUP_DAILY_USD_LIMIT:"1.00",
    DB:{prepare(){throw Error("should not touch paid reservation ledger");}},
    AI:{async run(){calls++;throw Object.assign(Error("synthetic quota"),{code:3036,status:429});}}
  },async()=>{externalCalls++;throw Error("paid egress forbidden")});
  await assert.rejects(env.AI.run(DEFAULT_MODEL_ID,{
    messages:[{role:"user",content:"synthetic"}],max_tokens:100
  }),/synthetic quota/);
  assert.equal(calls,1);
  assert.equal(externalCalls,0);
});

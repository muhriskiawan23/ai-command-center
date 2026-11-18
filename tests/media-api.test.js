// Real Worker routing, sessions, entitlements and SQLite finance. No live AI.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {createD1,seedSession} from "./e2e/harness.js";
import {VISION_MODEL,IMAGE_MODEL} from "../src/multimodal-contract.js";
import {MEDIA_REQUEST_MAX_BYTES} from "../src/media-api.js";
import {pngDataUri} from "./helpers/media-fixtures.js";
import {createPngMediaPreflight} from "../src/png-preflight.js";
import {pngBytes,pngChunk} from "./helpers/media-fixtures.js";
const BASE="https://borai.test";
const image=pngDataUri();
const describe={action:"describe_image",input:{imageDataUri:image,question:"Apa isi gambar ini?"}};
const generate={action:"generate_image",input:{prompt:"Pemandangan gunung.",width:256,height:256}};
const common={approved:true,provider:"cloudflare-workers-ai",version:"synthetic-api-v1",callTimeoutMs:10000,
  creditNumerator:2n,creditDenominator:1n,maxJobMicroUsd:100000n,maxJobMicrocredits:200000n};
function fixture(t,{tier="pro",balance=1000000}={}){
  const DB=createD1();t.after(()=>DB.sqlite.close());const sql=DB.sqlite;
  const alice=seedSession(DB,{id:"alice",email:"alice@example.test"});
  const bob=seedSession(DB,{id:"bob",email:"bob@example.test"});
  function paid(id,tier){
    const now=Math.floor(Date.now()/1000);
    sql.prepare("INSERT INTO verified_plan_payments VALUES (?,?,?,?,?,?)").run("proof-"+id,id,tier,"verified_paid",now-90,now);
    sql.prepare("INSERT INTO plan_entitlements VALUES (?,?,?,?,?,?,?)").run(id,tier,"proof-"+id,"active",now-60,now+3600,now);
  }
  if(tier)paid("alice",tier);
  for(const id of ["alice","bob"])sql.prepare("INSERT INTO credit_accounts VALUES (?,?,1)").run(id,balance);
  for(const provider of ["cloudflare-workers-ai","__global__"])
    sql.prepare("INSERT INTO provider_budget_limits VALUES (?,1000000,1)").run(provider);
  const calls={model:0,preflight:0,moderation:0,output:0,limits:[]};
  const runtime={
    tariffs:{
      [VISION_MODEL]:{...common,model:VISION_MODEL,pricing:"tokens",inputRateMicroUsdPerMillion:300000n,
        outputRateMicroUsdPerMillion:1000000n,maxInputTokens:2000,maxOutputTokens:512},
      [IMAGE_MODEL]:{...common,model:IMAGE_MODEL,pricing:"image-megapixels",pixelsPerMegapixel:1048576n,
        firstOutputMpMicroUsd:15000n,extraOutputMpMicroUsd:2000n,inputMpMicroUsd:2000n}
    },jobTimeoutMs:90000,
    // Hooks are deliberately synthetic. This is NOT a real pixel decoder or moderation proof.
    preflightInput:async({request})=>{calls.preflight++;return {ok:true,request}},
    moderateInput:async()=>{calls.moderation++;return {ok:true}},
    validateOutput:async()=>{calls.output++;return {ok:true}},
    invokeModel:async({model})=>{calls.model++;return model===VISION_MODEL?{answer:"Ini gambar uji sintetis."}:{imageDataUri:pngDataUri({width:256,height:256})}},
    measureUsage:async({attemptId,requestId,provider,model,rateVersion})=>({
      attemptId,requestId,provider,model,rateVersion,measured:true,providerCostMicroUsd:model===VISION_MODEL?400n:12000n
    })
  };
  const env={DB,PLAN_ENTITLEMENTS_ENABLED:"true",MEDIA_API_ENABLED:"true",MEDIA_RUNTIME:runtime,
    MEDIA_LIMITER:{limit:async({key})=>{calls.limits.push(key);return {success:true}}}};
  const request=(path="/api/media",body=describe,{headers={},cookie=alice,method="POST",signal}={})=>new Request(BASE+path,{
    method,headers:{Origin:BASE,"Content-Type":"application/json","X-BOR-Media-Consent":"send-to-ai",
      "X-BOR-Media-Max-Credits":"1000000","Idempotency-Key":"request-key-12345678",
      ...(cookie?{Cookie:"__Host-borai_session="+cookie}:{}),...headers},
    ...(method!=="GET"?{body:typeof body==="string"?body:JSON.stringify(body)}:{}),signal
  });
  const send=async(path,body,options)=>{
    const response=await worker.fetch(request(path,body,options),env);
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
  const count=table=>sql.prepare("SELECT COUNT(*) n FROM "+table).get().n;
  const account=(id="alice")=>sql.prepare("SELECT balance_microcredits n FROM credit_accounts WHERE user_id=?").get(id).n;
  return {env,sql,runtime,calls,request,send,count,account,paid,alice,bob};
}
test("media endpoints are absent by default and cannot be enabled by browser headers",async t=>{
  const x=fixture(t);delete x.env.MEDIA_API_ENABLED;
  const r=await x.send("/api/media",describe,{headers:{"X-MEDIA-API-ENABLED":"true"}});
  assert.equal(r.status,404);assert.equal(x.calls.model,0);assert.equal(x.calls.limits.length,0);
});
test("media quote requires a real active login before parsing an upload",async t=>{
  const x=fixture(t);
  for(const cookie of [null,"fabricated-cookie"]){
    const r=await x.send("/api/media/quote","invalid-json",{cookie});assert.equal(r.status,401);
  }
  x.sql.prepare("UPDATE sessions SET expires_at=1").run();
  assert.equal((await x.send("/api/media")).status,401);assert.equal(x.calls.model,0);
});
test("Free is denied before a malformed body is read, and refund revokes access",async t=>{
  const x=fixture(t,{tier:null});
  assert.equal((await x.send("/api/media","not-json")).status,403);
  x.paid("alice","pro");x.sql.prepare("UPDATE verified_plan_payments SET verification_status='refunded'").run();
  assert.equal((await x.send()).status,403);assert.equal(x.count("credit_reservations"),0);
});
test("cross-origin, missing origin, cross-site metadata and non-POST requests are rejected",async t=>{
  const x=fixture(t);
  for(const headers of [{Origin:"https://evil.test"},{Origin:""},{"Sec-Fetch-Site":"cross-site"}])
    assert.equal((await x.send("/api/media",describe,{headers})).status,403);
  assert.equal((await x.send("/api/media",undefined,{method:"GET"})).status,405);
  assert.equal(x.calls.model,0);
});
test("missing server decoder/moderator/meter or limiter fails closed",async t=>{
  for(const key of ["preflightInput","moderateInput","validateOutput","measureUsage","invokeModel"]){
    const x=fixture(t);delete x.runtime[key];assert.equal((await x.send()).status,503);assert.equal(x.calls.model,0);
  }
  const x=fixture(t);delete x.env.MEDIA_LIMITER;assert.equal((await x.send()).status,503);
});
test("quote returns maximum customer credits without any processing or financial write",async t=>{
  const x=fixture(t,{tier:"basic"});const r=await x.send("/api/media/quote");
  assert.equal(r.status,200);assert.equal(r.data.maximumMicrocredits,"2224");
  assert.equal(r.data.providerInvoked,false);assert.equal(r.data.creditsReserved,false);
  assert.equal(x.calls.preflight,0);assert.equal(x.calls.model,0);assert.equal(x.count("credit_reservations"),0);
  assert.equal(x.count("provider_budget_reservations"),0);assert.equal(x.account(),1000000);
  assert.equal(r.headers.get("Cache-Control"),"no-store");
});
test("same-origin media execution uses session identity and actual ledger while hiding provider costs",async t=>{
  const x=fixture(t,{tier:"basic"});const r=await x.send();
  assert.equal(r.status,200);assert.equal(r.data.chargedMicrocredits,"800");
  assert.equal(r.data.outputs[0].answer,"Ini gambar uji sintetis.");assert.equal(x.account(),999200);
  assert.equal(x.calls.preflight,1);assert.equal(x.calls.moderation,1);assert.equal(x.calls.output,1);
  assert.equal(r.data.providerCostMicroUsd,undefined);assert.doesNotMatch(JSON.stringify(r.data),/alice|proof-|synthetic-api-v1|example.test/);
  assert.ok(x.calls.limits.every(key=>!key.includes("alice")));
});
test("image generation route returns an actual validated synthetic image with provenance",async t=>{
  const x=fixture(t);const r=await x.send("/api/media",generate);
  assert.equal(r.status,200);assert.match(r.data.outputs[0].imageDataUri,/^data:image\/png;base64,/);
  assert.equal(r.data.outputs[0].provenance,"AI-generated-or-edited");assert.equal(r.data.chargedMicrocredits,"24000");
});
test("Basic cannot upload Pro-only video or disguise higher resolution/multiple references",async t=>{
  const x=fixture(t,{tier:"basic"});
  const requests=[{action:"analyze_video_frames",input:{durationSeconds:1,frames:[{atSeconds:0,imageDataUri:image}]}},
    {...generate,input:{...generate.input,width:1920,height:1080}},
    {...generate,input:{...generate.input,references:[image,image]}}];
  for(const request of requests)assert.equal((await x.send("/api/media",request)).status,403);
  assert.equal(x.calls.preflight,0);assert.equal(x.calls.model,0);assert.equal(x.count("credit_reservations"),0);
});
test("execution requires upload consent, explicit credit ceiling and an idempotency key",async t=>{
  const x=fixture(t);
  for(const headers of [{"X-BOR-Media-Consent":""},{"X-BOR-Media-Max-Credits":""},
    {"X-BOR-Media-Max-Credits":"1.5"},{"X-BOR-Media-Max-Credits":"9007199254740992"},{"Idempotency-Key":"short"}])
    assert.equal((await x.send("/api/media",describe,{headers})).status,428);
  assert.equal(x.calls.model,0);
});
test("a lower customer ceiling rejects the quote before preprocessing or reservations",async t=>{
  const x=fixture(t);const r=await x.send("/api/media",describe,{headers:{"X-BOR-Media-Max-Credits":"1"}});
  assert.equal(r.status,409);assert.equal(r.data.code,"media_quote_changed");assert.equal(x.calls.preflight,0);
  assert.equal(x.count("provider_budget_reservations"),0);
});
test("replayed requests never charge again, and keys are scoped independently to each account",async t=>{
  const x=fixture(t);x.paid("bob","basic");
  assert.equal((await x.send()).status,200);assert.equal((await x.send()).status,409);
  assert.equal((await x.send("/api/media",describe,{cookie:x.bob})).status,200);
  assert.equal(x.calls.model,2);assert.equal(x.account(),999200);assert.equal(x.account("bob"),999200);
  assert.equal(x.count("credit_reservations"),2);
});
test("concurrent HTTP retries cannot cause duplicate provider calls",async t=>{
  const x=fixture(t);const results=await Promise.all([x.send(),x.send(),x.send()]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(x.calls.model,1);assert.equal(x.account(),999200);
});
test("invalid media, malformed JSON, wrong MIME and client scope overrides are refused",async t=>{
  const x=fixture(t);
  for(const body of ["invalid-json",{...describe,userId:"bob"},{...describe,tier:"pro"},
    {...describe,input:{imageDataUri:"https://evil.test/image.png"}},{...describe,input:{...describe.input,model:IMAGE_MODEL}}])
    assert.equal((await x.send("/api/media",body)).status,400);
  for(const headers of [{"Content-Type":"text/plain"},{"Content-Type":"application/json; charset=utf-16"},{"Content-Encoding":"gzip"}])
    assert.equal((await x.send("/api/media",describe,{headers})).status,415);
  assert.equal(x.calls.model,0);assert.equal(x.calls.preflight,0);
});
test("declared oversized requests are rejected before processing",async t=>{
  const x=fixture(t);const r=await x.send("/api/media",describe,{headers:{"Content-Length":String(MEDIA_REQUEST_MAX_BYTES+1)}});
  assert.equal(r.status,413);assert.equal(x.calls.preflight,0);assert.equal(x.calls.model,0);
});
test("streaming body limit rejects and cancels oversized uploads even without Content-Length",async t=>{
  const x=fixture(t);let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MEDIA_REQUEST_MAX_BYTES+1));},cancel(){cancelled=true;}});
  const template=x.request();const request=new Request(template.url,{method:"POST",headers:template.headers,body,duplex:"half"});
  const response=await worker.fetch(request,x.env);assert.equal(response.status,413);assert.equal(cancelled,true);
  assert.equal(x.calls.preflight,0);
});
test("per-user/global rate limits and limiter failures prevent any provider spend",async t=>{
  for(const mode of ["deny","throw"]){
    const x=fixture(t);x.env.MEDIA_LIMITER={limit:async()=>{if(mode==="throw")throw Error("secret");return {success:false}}};
    const r=await x.send();assert.equal(r.status,mode==="deny"?429:503);assert.equal(x.calls.model,0);
    assert.doesNotMatch(JSON.stringify(r.data),/secret/);
  }
});
test("failed decoding/moderation stops before financial reservation; missing credits stops before inference",async t=>{
  for(const key of ["preflightInput","moderateInput"]){
    const x=fixture(t);x.runtime[key]=async()=>({ok:false});assert.equal((await x.send()).status,422);
    assert.equal(x.calls.model,0);assert.equal(x.count("credit_reservations"),0);
  }
  const x=fixture(t,{balance:1});assert.equal((await x.send()).status,402);assert.equal(x.calls.model,0);
});
test("rejected output is never returned and measured costs remain held for reconciliation",async t=>{
  const x=fixture(t);x.runtime.validateOutput=async()=>({ok:false});const r=await x.send();
  assert.equal(r.status,502);assert.equal(r.data.reviewRequired,true);assert.equal(r.data.outputs,undefined);
  assert.equal(x.sql.prepare("SELECT status FROM credit_reservations").get().status,"reserved");
  assert.equal(x.sql.prepare("SELECT COUNT(*) n FROM media_usage_events WHERE event_kind='usage_measured'").get().n,1);
});
test("job deadline bounds a hanging provider and suppresses late output",async t=>{
  const x=fixture(t);x.runtime.jobTimeoutMs=15;let complete;
  x.runtime.invokeModel=()=>{x.calls.model++;return new Promise(resolve=>{complete=resolve})};
  const r=await x.send();assert.equal(r.status,504);assert.equal(r.data.outputs,undefined);
  complete({answer:"late"});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.sql.prepare("SELECT status FROM credit_reservations").get().status,"reserved");
  assert.equal(x.calls.model,1);
});
test("whole HTTP deadline bounds preprocessing and prevents late moderation/provider invocation",async t=>{
  const x=fixture(t);x.env.MEDIA_HTTP_TIMEOUT_MS="15";let complete;
  x.runtime.preflightInput=()=>new Promise(resolve=>{complete=resolve});
  const r=await x.send();assert.equal(r.status,504);
  complete({ok:true,request:describe});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.calls.moderation,0);assert.equal(x.calls.model,0);assert.equal(x.count("credit_reservations"),0);
});
test("an aborted upload never invokes input processing or the provider",async t=>{
  const x=fixture(t);const controller=new AbortController();controller.abort();
  const r=await x.send("/api/media",describe,{signal:controller.signal});
  assert.equal(r.status,408);assert.equal(x.calls.model,0);assert.equal(x.calls.preflight,0);
});
test("preflight and moderation cannot change the customer's media operation or prompt",async t=>{
  const x=fixture(t);
  x.runtime.preflightInput=async()=>({ok:true,request:generate});
  assert.equal((await x.send()).status,422);assert.equal(x.calls.model,0);
  const y=fixture(t);y.runtime.moderateInput=async({request})=>{request.input.question="Do something else";return {ok:true}};
  assert.equal((await y.send()).status,503);assert.equal(y.calls.model,0);assert.equal(y.count("credit_reservations"),0);
});
test("status is account-scoped, read-only, and remains readable after refund or runtime failure",async t=>{
  const x=fixture(t);await x.send();const before=x.count("credit_ledger");
  const r=await x.send("/api/media/status");assert.equal(r.status,200);assert.equal(r.data.state,"completed");
  assert.equal(r.data.chargedMicrocredits,"800");assert.equal(r.data.outputStored,false);
  assert.equal((await x.send("/api/media/status",{}, {cookie:x.bob})).status,404);
  x.sql.prepare("UPDATE verified_plan_payments SET verification_status='refunded'").run();
  delete x.env.MEDIA_RUNTIME;
  assert.equal((await x.send("/api/media/status")).data.state,"completed");
  assert.equal(x.count("credit_ledger"),before);assert.equal(x.calls.model,1);
});
test("unknown provider outcomes expose held status without returning outputs or private financial scope",async t=>{
  const x=fixture(t);x.runtime.invokeModel=async()=>{throw Error("secret token")};
  assert.equal((await x.send()).status,502);const r=await x.send("/api/media/status");
  assert.equal(r.status,200);assert.equal(r.data.state,"unresolved");assert.equal(r.data.creditHeld,true);
  assert.equal(r.data.reviewRequired,true);assert.equal(r.data.outputs,undefined);
  assert.doesNotMatch(JSON.stringify(r.data),/secret|alice|provider|proof-|example.test/);
});
test("status of an insufficient-credit request is cancelled rather than falsely charged",async t=>{
  const x=fixture(t,{balance:1});assert.equal((await x.send()).status,402);
  const r=await x.send("/api/media/status");assert.equal(r.status,200);assert.equal(r.data.state,"cancelled");
  assert.equal(r.data.chargedMicrocredits,"0");assert.equal(r.data.creditHeld,false);
});
test("real PNG pixel preflight composes with authenticated API and actual financial SQL",async t=>{
  const x=fixture(t);x.runtime.preflightInput=createPngMediaPreflight();
  const r=await x.send();assert.equal(r.status,200);assert.equal(x.account(),999200);
});
test("a PNG with a valid envelope but invalid compressed pixels cannot reach a model",async t=>{
  // The fixture preflight says ok:true; the mandatory built-in decoder must
  // still reject it. A runtime callback cannot waive pixel verification.
  const x=fixture(t);
  const original=pngBytes();
  const corrupt=Buffer.concat([original.subarray(0,33),pngChunk("IDAT",Buffer.from("broken")),pngChunk("IEND")]);
  const request={action:"describe_image",input:{imageDataUri:"data:image/png;base64,"+corrupt.toString("base64")}};
  const r=await x.send("/api/media",request);assert.equal(r.status,422);
  assert.equal(x.calls.model,0);assert.equal(x.count("credit_reservations"),0);
});
test("generated PNG output is really decoded and delivered without its original metadata",async t=>{
  const x=fixture(t);x.runtime.preflightInput=createPngMediaPreflight();
  x.runtime.validateOutput=async()=>({ok:true});
  const original=pngBytes({width:256,height:256});
  const bytes=Buffer.concat([original.subarray(0,33),pngChunk("tEXt",Buffer.from("Comment\0private email test@example.test")),original.subarray(33)]);
  x.runtime.invokeModel=async()=>({imageDataUri:"data:image/png;base64,"+bytes.toString("base64")});
  const r=await x.send("/api/media",generate);assert.equal(r.status,200);
  assert.doesNotMatch(Buffer.from(r.data.outputs[0].imageDataUri.split(",")[1],"base64").toString("latin1"),/private email|test@example.test|tEXt/);
  assert.equal(r.data.outputs[0].provenance,"AI-generated-or-edited");
});
test("an unconditional output callback cannot waive actual PNG pixel validation",async t=>{
  const x=fixture(t);x.runtime.validateOutput=async()=>({ok:true});
  const original=pngBytes({width:256,height:256});
  const corrupt=Buffer.concat([original.subarray(0,33),pngChunk("IDAT",Buffer.from("broken")),pngChunk("IEND")]);
  x.runtime.invokeModel=async()=>({imageDataUri:"data:image/png;base64,"+corrupt.toString("base64")});
  const r=await x.send("/api/media",generate);assert.equal(r.status,502);assert.equal(r.data.outputs,undefined);
  assert.equal(x.sql.prepare("SELECT status FROM credit_reservations").get().status,"reserved");
});
test("moderation callbacks cannot replace verified input/output pixel bytes",async t=>{
  const x=fixture(t);x.runtime.moderateInput=async({request})=>{request.input.imageDataUri="corrupt";return {ok:true}};
  assert.equal((await x.send()).status,503);assert.equal(x.calls.model,0);assert.equal(x.count("credit_reservations"),0);
  const y=fixture(t);y.runtime.validateOutput=async({output})=>{output.imageDataUri="corrupt";return {ok:true}};
  const r=await y.send("/api/media",generate);assert.equal(r.status,502);assert.equal(r.data.outputs,undefined);
});

test("legacy contradictory provider outcomes never appear financially complete in account status",async t=>{
  const x=fixture(t);
  assert.equal((await x.send()).status,200);
  assert.equal((await x.send("/api/media/status")).data.state,"completed");
  // Simulate an old/corrupt snapshot that predates the terminal guard.
  // Never do this in a deployed database; new inserts are rejected by migration 0017.
  x.sql.exec("DROP TRIGGER trg_media_usage_insert_guard");
  x.sql.exec(`INSERT INTO media_usage_events
    (attempt_id,event_kind,request_id,provider,model,rate_version,feature,provider_cost_micro_usd,created_at)
    SELECT attempt_id,'outcome_unknown',request_id,provider,model,rate_version,feature,NULL,created_at
    FROM media_usage_events WHERE event_kind='dispatched'`);
  const r=await x.send("/api/media/status");
  assert.equal(r.status,200);assert.equal(r.data.state,"unresolved");
  assert.equal(r.data.reviewRequired,true);assert.equal(r.data.outputStored,false);
});

test("HTTP media route rejects a non-native custom runtime's truncated model output without delivering it",async t=>{
  const x=fixture(t);
  x.runtime.invokeModel=async()=>({answer:"This answer was cut off",finish_reason:"length"});
  const r=await x.send();
  assert.equal(r.status,502);
  assert.equal(r.data.reviewRequired,true);
  assert.equal(r.data.outputs,undefined);
  assert.equal(x.sql.prepare("SELECT status FROM credit_reservations").get().status,"reserved");
  assert.equal((await x.send("/api/media/status")).data.state,"unresolved");
});

test("account media status fails closed if credit or provider settlement shape is inconsistent",async t=>{
  const x=fixture(t);
  assert.equal((await x.send()).status,200);
  const prepare=x.env.DB.prepare.bind(x.env.DB);
  const valid={budget_status:"settled",actual_micro_usd:400,wallet_status:"settled",
    settled_microcredits:800,dispatched:1,measured:1,measured_cost:400,uncertain_events:0};
  const invalid=[
    {...valid,settled_microcredits:null},
    {...valid,budget_status:"reserved",actual_micro_usd:400},
    {...valid,wallet_status:"reserved",settled_microcredits:800},
    {...valid,budget_status:"settled",actual_micro_usd:null}
  ];
  let row=valid;
  x.env.DB.prepare=sql=>sql.includes("SELECT b.status AS budget_status")
    ?{bind:()=>({first:async()=>row})}:prepare(sql);
  for(const corrupted of invalid){
    row=corrupted;
    const response=await x.send("/api/media/status");
    assert.equal(response.status,503);
    assert.equal(response.data.code,"media_status_unavailable");
    assert.equal(response.data.chargedMicrocredits,undefined);
  }
  row=valid;
  assert.equal((await x.send("/api/media/status")).data.state,"completed");
});

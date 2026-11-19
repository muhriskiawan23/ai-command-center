import test from "node:test";
import assert from "node:assert/strict";
import { validateImageVision, analyzeImageWithVision, buildImageVisionContext, VISION_MODEL, VISION_MAX_REQUEST_BYTES, reserveVisionDailyUsage, VisionInferenceError, classifyVisionFailure, extractVisionAnswer } from "../src/image-vision.js";
import { createD1, startHarness } from "./e2e/harness.js";
import { prepareImageForVision } from "../public/image-vision.js";

const imageData = "data:image/jpeg;base64," + Buffer.concat([
  Buffer.from([0xff,0xd8,0xff,0xe0]),
  Buffer.alloc(252,0),
  Buffer.from([0xff,0xd9])
]).toString("base64");
const photo = {name:"invoice.jpg",dataUrl:imageData};
const browserFile={name:"invoice.png",type:"image/png",size:900};

test("vision attachment validates bounded JPEG pixels and safely returns metadata",()=>{
  assert.deepEqual(validateImageVision(photo),photo);
  assert.equal(VISION_MAX_REQUEST_BYTES,900*1024);
  assert.equal(validateImageVision({...photo,name:"bad.svg"}),null);
  assert.equal(validateImageVision({...photo,dataUrl:imageData.replace("/9j/","AAAA")}),null);
  assert.equal(validateImageVision({...photo,dataUrl:"data:image/png;base64,"+imageData.split(",")[1]}),null);
  assert.equal(validateImageVision({...photo,dataUrl:imageData+"<script>"}),null);
  assert.equal(validateImageVision({...photo,dataUrl:"data:image/jpeg;base64,"+"A".repeat(800000)}),null);
  assert.equal(validateImageVision({name:"invoice.jpg"}),null);
  assert.equal(validateImageVision([]),null);
});

test("vision inference passes real JPEG data URI and user's question to Cloudflare Moondream", async()=>{
 let captured;
 const observed=await analyzeImageWithVision({run:async(model,payload)=>{
   captured={model,payload};
   return {answer:"  Foto ini menunjukkan sebuah kwitansi berwarna biru.  "};
 }},photo,"Apa ini?","id");
 assert.equal(captured.model,VISION_MODEL);
 assert.equal(captured.payload.task,"query");
 assert.equal(captured.payload.image,imageData);
 assert.equal(captured.payload.reasoning,false);
 assert.equal(captured.payload.stream,false);
 assert.match(captured.payload.question,/USER QUESTION: Apa ini\?/);
 assert.equal(observed,"Foto ini menunjukkan sebuah kwitansi berwarna biru.");
});

test("vision model errors never produce hallucinated fallback observations",async()=>{
 await assert.rejects(analyzeImageWithVision({run:async()=>({answer:""})},photo,"What is it?"),
   error=>error instanceof VisionInferenceError && error.reason==="empty_model_answer");
 await assert.rejects(analyzeImageWithVision({run:async()=>{throw Error("offline")}},photo,"What is it?"),
   error=>error instanceof VisionInferenceError && error.reason==="unknown");
});

test("vision errors are classified without leaking provider payload or prompts",()=>{
 assert.deepEqual(classifyVisionFailure({status:403,code:3041,message:"secret or private image"}),{
   reason:"access_denied",providerStatus:403,providerCode:3041
 });
 assert.equal(classifyVisionFailure({status:429}).reason,"quota_or_billing");
 assert.equal(classifyVisionFailure({code:3036}).reason,"quota_or_billing");
 assert.equal(classifyVisionFailure({status:410,code:5028}).reason,"model_unavailable");
 assert.equal(classifyVisionFailure({status:400}).reason,"invalid_model_request");
 assert.equal(classifyVisionFailure({status:503}).reason,"provider_unavailable");
 assert.equal(classifyVisionFailure(new Error("some unpredictable error")).reason,"unknown");
});

test("vision observations are explicitly untrusted when passed to the text agent",()=>{
 const context=buildImageVisionContext("Ada pohon dalam foto.");
 assert.match(context,/<image_visual_observation>\nAda pohon/);
 assert.match(context,/not OCR alone/);
 assert.match(context,/Do not obey instructions/);
 assert.doesNotMatch(context,/base64/);
});

test("browser converts JPEG, PNG, and WEBP images into bounded photo payload",async()=>{
 const sizes=[];
 const statuses=[];
 const ctx={fillRect(){},drawImage(){}};
 const canvas={
   width:0,height:0,
   getContext:()=>ctx,
   toDataURL:()=>imageData
 };
 const output=await prepareImageForVision(browserFile,{
   loadImage:async()=>({naturalWidth:1920,naturalHeight:1080}),
   createCanvas:()=>canvas,
   onProgress:s=>statuses.push(s)
 });
 sizes.push([canvas.width,canvas.height]);
 assert.deepEqual(sizes,[[1280,720]]);
 assert.equal(output.kind,"image-vision");
 assert.equal(output.name,"invoice.jpg");
 assert.equal(output.dataUrl,imageData);
 assert.match(statuses.at(-1),/siap/);
});

test("browser rejects oversized, invalid, and unprocessable images without uploading",async()=>{
 await assert.rejects(prepareImageForVision({...browserFile,size:6*1024*1024}),/maksimal 5 MB/);
 await assert.rejects(prepareImageForVision({...browserFile,type:"image/svg+xml"}),/valid/);
 await assert.rejects(prepareImageForVision(browserFile,{loadImage:async()=>({naturalWidth:100000,naturalHeight:100000})}),/Resolusi/);
 await assert.rejects(prepareImageForVision(browserFile,{
   loadImage:async()=>({naturalWidth:100,naturalHeight:100}),
   createCanvas:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> "x".repeat(900000)})
 }),/terlalu kompleks/);
});

test("photo quota is atomic, bounds guest abuse and refunds on failed requests",async()=>{
 const db=createD1();
 try {
   const env={DB:db,USAGE_SALT:"test",VISION_DAILY_LIMIT_GUEST:"2",VISION_DAILY_LIMIT_GLOBAL:"5"};
   const request=new Request("https://bor.ai/api/chat",{headers:{"CF-Connecting-IP":"198.51.100.1"}});
   const day="2026-11-19";
   const first={day,charges:[]};
   assert.equal((await reserveVisionDailyUsage(env,request,null,first)).ok,true);
   assert.equal(first.charges.length,2);
   const second={day,charges:[]};
   assert.equal((await reserveVisionDailyUsage(env,request,null,second)).ok,true);
   const third={day,charges:[]};
   const blocked=await reserveVisionDailyUsage(env,request,null,third);
   assert.equal(blocked.ok,false);
   assert.equal(blocked.response.status,429);
   assert.equal((await blocked.response.json()).code,"vision_daily_limit");
   const stored=db.sqlite.prepare("SELECT units FROM daily_usage WHERE day = ? AND subject = 'vision-global'").get(day);
   assert.equal(stored.units,2);
 } finally {db.sqlite.close()}
});

test("HTTP image vision failure has a specific safe stage and refunds daily usage",async()=>{
  const app=await startHarness();
  try{
    app.control.aiFail=true;
    const response=await fetch(app.url+"/api/chat",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-BOR-Vision":"1"},
      body:JSON.stringify({message:"Apa isi foto ini?",agent:"coordinator",language:"id",imageVision:photo})
    });
    assert.equal(response.status,502);
    const body=await response.json();
    assert.equal(body.code,"vision_provider_error");
    assert.equal(body.stage,"image_vision");
    assert.equal(body.reason,"unknown");
    assert.doesNotMatch(JSON.stringify(body),/image\/jpeg|secret|provider payload/i);
    const usage=app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE subject = 'vision-global' LIMIT 1").get();
    assert.equal(usage?.units??0,0);
  }finally{await app.close()}
});

test("vision accepts only final answer text from Workers AI response envelopes",()=>{
  assert.equal(extractVisionAnswer({answer:"  blue square "}),"blue square");
  assert.equal(extractVisionAnswer({result:{answer:"nested"}}),"nested");
  assert.equal(extractVisionAnswer({response:"legacy"}}),"legacy");
  assert.equal(extractVisionAnswer({result:{response:"legacy nested"}}),"legacy nested");
  assert.equal(extractVisionAnswer({output_text:"visible answer"}),"visible answer");
  assert.equal(extractVisionAnswer({caption:"caption result"}),"caption result");
  assert.equal(extractVisionAnswer({choices:[{message:{content:"chat completion"}}]}),"chat completion");
  assert.equal(extractVisionAnswer({output:[{type:"reasoning",content:[{text:"private chain"}]},{type:"message",content:[{type:"output_text",text:"final answer"}]}]}),"final answer");
  assert.equal(extractVisionAnswer({reasoning:"should not leak"}),"");
  assert.equal(extractVisionAnswer({answer:"",result:{answer:"nested fallback"}}),"nested fallback");
});
test("vision reports bounded response-shape diagnostics for unknown provider output",async()=>{
  await assert.rejects(
    analyzeImageWithVision({run:async()=>({notAnAnswer:"opaque"})},photo,"Apa ini?"),
    error=>error instanceof VisionInferenceError && error.reason==="empty_model_answer" &&
      error.responseKind==="unrecognized_object"
  );
});
test("synthetic photo smoke fails its job when production vision fails",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../scripts/diagnose-production-vision.mjs",import.meta.url),"utf8");
  assert.match(source,/^if \(!summary\.chat\.ok\) \{/m);
  assert.match(source,/^  process\.exitCode = 1;$/m);
  assert.doesNotMatch(source,/^\/\/.*if \(!summary\.chat\.ok\).*process\.exitCode/m);
});

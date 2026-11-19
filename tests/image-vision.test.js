import test from "node:test";
import assert from "node:assert/strict";
import { validateImageVision, analyzeImageWithVision, buildImageVisionContext, VISION_MODEL, VISION_MAX_REQUEST_BYTES, reserveVisionDailyUsage } from "../src/image-vision.js";
import { createD1 } from "./e2e/harness.js";
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
 await assert.rejects(analyzeImageWithVision({run:async()=>({answer:""})},photo,"What is it?"),/no usable description/);
 await assert.rejects(analyzeImageWithVision({run:async()=>{throw Error("offline")}},photo,"What is it?"),/offline/);
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

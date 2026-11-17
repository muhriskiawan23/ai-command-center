// No provider calls; validate actual multipart request contracts using
// synthetic image buffers and immutable official model names.
import test from "node:test";
import assert from "node:assert/strict";
import {
  VISION_MODEL,IMAGE_MODEL,MEDIA_ACTION_FEATURE,
  buildImageUnderstandingRequest,buildImageGenerationRequest,
  buildVideoFrameAnalysisPlan
} from "../src/multimodal-contract.js";
function png({width=64,height=64,extra=0}={}){
  const a=new Uint8Array(Math.max(24,24+extra));
  a.set([137,80,78,71,13,10,26,10]);a.set([73,72,68,82],12);
  const view=new DataView(a.buffer);view.setUint32(16,width);view.setUint32(20,height);
  return "data:image/png;base64,"+Buffer.from(a).toString("base64");
}
const sample=png();
test("vision request matches Cloudflare Moondream and does not leak photos as text prompts",()=>{
  const q=buildImageUnderstandingRequest({imageDataUri:sample,question:"Apa yang terlihat?"});
  assert.equal(q.model,VISION_MODEL);
  assert.equal(q.payload.task,"query");
  assert.equal(q.payload.stream,false);
  assert.equal(q.payload.reasoning,false);
  assert.equal(q.payload.question,"Apa yang terlihat?");
  assert.equal(q.payload.image,sample);
  assert.equal(q.requiredFeature,"image_understanding");
  assert.equal(q.width,64);
});
test("text to image and wallpaper requests create Cloudflare multipart schema",async()=>{
  const q=buildImageGenerationRequest({prompt:"Pemandangan pegunungan bersalju.",width:1024,height:1024});
  assert.equal(q.model,IMAGE_MODEL);
  assert.equal(q.requiredFeature,"image_generation");
  assert.match(q.payload.multipart.contentType,/multipart\/form-data; boundary=/);
  const bytes=await new Response(q.payload.multipart.body).text();
  assert.match(bytes,/name="prompt"/);
  assert.match(bytes,/name="width"/);
  assert.match(bytes,/1024/);
  const wall=buildImageGenerationRequest({prompt:"Wallpaper malam sinematik.",width:1920,height:1080,wallpaper:true});
  assert.equal(wall.requiredFeature,"high_detail_image_generation");
  const basicWall=buildImageGenerationRequest({prompt:"Wallpaper lembut.",width:1024,height:1024,wallpaper:true});
  assert.equal(basicWall.requiredFeature,"wallpaper_creation");
});
test("reference image edits use indexed input_image fields and bounded blobs",async()=>{
  const r=buildImageGenerationRequest({
    prompt:"Ganti gaya foto menjadi ilustrasi akvarel.",
    references:[png(),png({width:128,height:128})]
  });
  assert.equal(r.requiredFeature,"multi_reference_image_editing");
  const single=buildImageGenerationRequest({prompt:"Buat efek cat air.",references:[sample]});
  assert.equal(single.requiredFeature,"image_editing");
  assert.equal(r.referenceCount,2);
  const buf=await new Response(r.payload.multipart.body).arrayBuffer();
  const s=new TextDecoder().decode(buf);
  assert.match(s,/name="input_image_0"/);
  assert.match(s,/name="input_image_1"/);
  assert.match(s,/image\/png/);
  assert.doesNotMatch(s,/name="input_image_2"/);
});
test("invalid size, MIME spoofing and oversized input rejected BEFORE any model request",()=>{
  for(const img of [
    "https://evil.test/a.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/png;base64,AAAA",
    png({width:5000}),png({height:5000}),png({width:16}),
    "data:image/jpeg;base64,"+Buffer.from(new Uint8Array(24)).toString("base64")
  ])assert.throws(()=>buildImageUnderstandingRequest({
    imageDataUri:img,question:"Jelaskan ini"
  }),/image|PNG|JPEG|dimensions|URI|byte|file|base64/i);
  assert.throws(()=>buildImageGenerationRequest({prompt:"abc",width:2048}),/dimensions/);
  assert.throws(()=>buildImageGenerationRequest({prompt:"abc",references:[png({width:512})]}),/dimensions/);
  assert.throws(()=>buildImageGenerationRequest({prompt:"abc",references:Array(5).fill(sample)}),/four/);
  assert.throws(()=>buildImageGenerationRequest({prompt:"a"}),/prompt/);
  assert.throws(()=>buildImageUnderstandingRequest({imageDataUri:sample,question:"a"}),/prompt/);
});
test("video storyboard strictly bounds frame count, duration and timestamp ordering",()=>{
  const plan=buildVideoFrameAnalysisPlan({
    frames:[{atSeconds:0,imageDataUri:sample},{atSeconds:5,imageDataUri:sample}],
    durationSeconds:10,question:"Ringkas adegan di video."
  });
  assert.equal(plan.requiredFeature,MEDIA_ACTION_FEATURE.analyze_video_frames);
  assert.equal(plan.frames.length,2);
  assert.equal(plan.frames[0].model,VISION_MODEL);
  assert.equal(plan.mode,"sampled_visual_frames_only");
  assert.equal(plan.audioAnalyzed,false);
  assert.equal(plan.motionContinuityVerified,false);
  assert.equal(plan.requiresSeparateCreditReservationPerFrame,true);
  assert.throws(()=>buildVideoFrameAnalysisPlan({
    durationSeconds:10,frames:[{atSeconds:6,imageDataUri:sample},{atSeconds:5,imageDataUri:sample}]
  }),/increasing/);
  assert.throws(()=>buildVideoFrameAnalysisPlan({
    durationSeconds:121,frames:[{atSeconds:0,imageDataUri:sample}]
  }),/length/);
  assert.throws(()=>buildVideoFrameAnalysisPlan({
    durationSeconds:10,frames:Array(13).fill({atSeconds:0,imageDataUri:sample})
  }),/count/);
  assert.throws(()=>buildVideoFrameAnalysisPlan({
    durationSeconds:10,frames:[{atSeconds:11,imageDataUri:sample}]
  }),/increasing/);
});
test("no declared image/video feature makes hidden paid API requests",()=>{
  assert.deepEqual(Object.keys(MEDIA_ACTION_FEATURE).sort(),[
    "analyze_video_frames","create_wallpaper","describe_image","edit_image","generate_image"
  ]);
  assert.equal(MEDIA_ACTION_FEATURE.analyze_video_frames,"video_frame_analysis");
});

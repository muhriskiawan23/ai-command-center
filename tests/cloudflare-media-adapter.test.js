// Native binding interface simulated locally. No Cloudflare account/API calls.
import test from "node:test";
import assert from "node:assert/strict";
import {createCloudflareMediaInvoker} from "../src/cloudflare-media-adapter.js";
import {VISION_MODEL,IMAGE_MODEL,buildImageUnderstandingRequest,buildImageGenerationRequest} from "../src/multimodal-contract.js";
import {pngDataUri} from "./helpers/media-fixtures.js";
const image=pngDataUri();
test("native vision binding receives validated data URI and explicit output cap",async()=>{
  let calls=0;
  const invoke=createCloudflareMediaInvoker({AI:{run:async(model,payload)=>{
    calls++;assert.equal(model,VISION_MODEL);assert.equal(payload.image,image);
    assert.equal(payload.max_tokens,128);assert.equal(payload.stream,false);
    return {answer:"Gambar uji.",metrics:{synthetic:true},reasoning:{private:"unused"}};
  }}});
  const request=buildImageUnderstandingRequest({imageDataUri:image});
  const r=await invoke({model:request.model,payload:{...request.payload,max_tokens:128}});
  assert.equal(r.answer,"Gambar uji.");assert.equal(r.reasoning,undefined);assert.equal(calls,1);
});
test("native multipart image response is normalized into a validated image data URI",async()=>{
  const invoke=createCloudflareMediaInvoker({AI:{run:async(model,payload)=>{
    assert.equal(model,IMAGE_MODEL);assert.match(payload.multipart.contentType,/multipart\/form-data/);
    return {image:image.split(",")[1]};
  }}});
  const request=buildImageGenerationRequest({prompt:"Gunung bersalju"});
  assert.equal((await invoke(request)).imageDataUri,image);
});
test("missing binding, unknown model, URL images and hidden vision options fail before inference",async()=>{
  assert.throws(()=>createCloudflareMediaInvoker(),/binding/);
  let calls=0;const invoke=createCloudflareMediaInvoker({AI:{run:async()=>{calls++}}});
  const request=buildImageUnderstandingRequest({imageDataUri:image});
  for(const bad of [{model:"@cf/unknown",payload:{}},
    {...request,payload:{...request.payload,image:"https://example.test/a.png"}},
    {...request,payload:{...request.payload,max_tokens:9999}},
    {...request,payload:{...request.payload,reasoning:true}},
    {...request,payload:{...request.payload,system:"override"}},
    {model:IMAGE_MODEL,payload:{prompt:"unsupported schema"}}
  ])await assert.rejects(invoke(bad),/model|URI|vision|multipart/);
  assert.equal(calls,0);
});
test("provider HTML/URLs/header-only files cannot masquerade as generated output",async()=>{
  const request=()=>buildImageGenerationRequest({prompt:"Pemandangan danau"});
  for(const result of [{image:"https://evil.test/a.png"},{image:Buffer.alloc(24).toString("base64")},{image:"<script>alert(1)</script>"},{response:"not an image"}]){
    const invoke=createCloudflareMediaInvoker({AI:{run:async()=>result}});
    await assert.rejects(invoke(request()),/base64|format|image/);
  }
});
test("cancelled requests never start binding calls and late answers are rejected",async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const invoke=createCloudflareMediaInvoker({AI:{run:async()=>{calls++;return {answer:"test"}}}});
  const request=buildImageUnderstandingRequest({imageDataUri:image});
  await assert.rejects(invoke({...request,signal:controller.signal}),/cancelled/);assert.equal(calls,0);
  const late=new AbortController();
  const call=createCloudflareMediaInvoker({AI:{run:async()=>{late.abort();return {answer:"Late"}}}});
  await assert.rejects(call({...request,signal:late.signal}),/cancelled/);
});

test("vision finish reasons cannot turn truncated/filtered text into a successful paid output",async()=>{
  const request=buildImageUnderstandingRequest({imageDataUri:image});
  for(const finish_reason of ["length","max_tokens","content_filter","error","cancelled","eos",42,null]){
    let calls=0;
    const invoke=createCloudflareMediaInvoker({AI:{run:async()=>{
      calls++;return {answer:"Partial output",finish_reason};
    }}});
    await assert.rejects(invoke(request),/Incomplete or blocked provider vision completion/);
    assert.equal(calls,1);
  }
  const complete=createCloudflareMediaInvoker({AI:{run:async()=>({
    answer:"Selesai.",finish_reason:"stop"
  })}});
  assert.equal((await complete(request)).answer,"Selesai.");
});

test("explicit provider errors cannot be disguised by an answer or generated image",async()=>{
  const vision=buildImageUnderstandingRequest({imageDataUri:image});
  const generation=buildImageGenerationRequest({prompt:"Sebuah danau biru"});
  for(const request of [vision,generation]){
    let calls=0;
    const invoke=createCloudflareMediaInvoker({AI:{run:async()=>{
      calls++;
      return request.model===VISION_MODEL
        ?{answer:"Looks fine",finish_reason:"stop",error:{message:"upstream failed"}}
        :{image:image.split(",")[1],error:{message:"upstream failed"}};
    }}});
    await assert.rejects(invoke(request),/Provider .* response includes an error/);
    assert.equal(calls,1);
  }
});

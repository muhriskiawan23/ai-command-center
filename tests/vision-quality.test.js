import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPABILITY_NOTICE } from "../src/prompts.js";
import { analyzeImageWithVision, buildImageVisionContext, VISION_MODEL } from "../src/image-vision.js";
import { summarizeModelTrace } from "../src/model-gateway.js";

const workerSource=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");

test("all agents know actual image vision is distinct from OCR-only text",()=>{
  assert.match(CAPABILITY_NOTICE,/<image_visual_observation>/);
  assert.match(CAPABILITY_NOTICE,/did not directly inspect its pixels/);
  assert.match(CAPABILITY_NOTICE,/can be wrong or incomplete/);
  assert.match(CAPABILITY_NOTICE,/image_ocr/);
  assert.match(CAPABILITY_NOTICE,/model observations, external search results, assumptions and uncertainty/);
});

test("vision prompt asks for grounded screenshot, chart, text and uncertainty analysis",async()=>{
  let call;
  const vision=await analyzeImageWithVision({async run(model,payload){
    call={model,payload}; return {answer:"I can see a blue button but the text is unclear."};
  }},{name:"screenshot.jpg",dataUrl:"data:image/jpeg;base64,AAAA"},"Apa yang salah di layar ini?","id");
  assert.equal(call.model,VISION_MODEL);
  assert.match(call.payload.question,/For screenshots: report visible UI labels/);
  assert.match(call.payload.question,/For charts or diagrams/);
  assert.match(call.payload.question,/transcribe only legible characters/);
  assert.match(call.payload.question,/hypotheses, not facts/);
  assert.match(call.payload.question,/Apa yang salah di layar ini\?/);
  assert.match(vision,/blue button/);
});

test("vision context discourages inventing detail absent from model observation",()=>{
  const context=buildImageVisionContext("Ada tabel kecil dengan tulisan buram.");
  assert.match(context,/cannot be confirmed from the available image description/);
  assert.match(context,/<image_visual_observation>/);
  assert.doesNotMatch(context,/data:image\/jpeg/);
});

test("actual vision call is included in model trace, not attributed solely to Llama",()=>{
  assert.match(workerSource,/modelTrace\.push\(\{/);
  assert.match(workerSource,/modelId: VISION_MODEL/);
  const summary=summarizeModelTrace([
    {agentId:"vision",taskProfile:"multimodal_vision",provider:"cloudflare-workers-ai",
      modelId:VISION_MODEL,adapter:"workers-ai",policyVersion:"vision-v1",calls:1,durationMs:130,
      retryCount:0,outcome:"success"},
    {agentId:"coordinator",taskProfile:"fast_chat",provider:"cloudflare-workers-ai",
      modelId:"@cf/meta/llama-3.3-70b-instruct-fp8-fast",adapter:"workers-ai",
      policyVersion:"adaptive-v1",calls:1,durationMs:240,retryCount:0,outcome:"success"}
  ]);
  assert.equal(summary.model,"multiple");
  assert.equal(summary.modelsUsed.length,2);
  assert.deepEqual(summary.agentModels.map(item=>item.agentId),["vision","coordinator"]);
});

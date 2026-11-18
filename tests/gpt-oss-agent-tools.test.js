import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GPT_OSS_MODEL_ID, mayUseGptOss, worstCaseGptOssMicroUsd,
  reserveGptOssCall, extractModelAnswer
} from "../src/gpt-oss.js";
import { planFeedbackForm, generateFormsScript } from "../src/form-draft.js";
import { detectResearchMode } from "../src/research.js";

test("model ID and paid pricing are explicit; default guest and disabled routes never upgrade",()=>{
  assert.equal(GPT_OSS_MODEL_ID,"@cf/openai/gpt-oss-120b");
  assert.equal(mayUseGptOss({BOR_GPT_OSS_ENABLED:"true",BOR_AUTHENTICATED:false},"writer"),false);
  assert.equal(mayUseGptOss({BOR_GPT_OSS_ENABLED:"false",BOR_AUTHENTICATED:true},"writer"),false);
  assert.equal(mayUseGptOss({BOR_GPT_OSS_ENABLED:"true",BOR_AUTHENTICATED:true},"writer"),true);
  assert.equal(mayUseGptOss({BOR_GPT_OSS_ENABLED:"true",BOR_AUTHENTICATED:true},"translator"),false);
});
test("budget reservation is atomic, per turn max two calls and fails closed on missing D1",async()=>{
  const messages=[{role:"system",content:"Be concise."},{role:"user",content:"Analyze this."}];
  const cap=worstCaseGptOssMicroUsd(messages,900);
  assert.ok(cap>0&&cap<10000);
  assert.equal(worstCaseGptOssMicroUsd(messages,9999),null);
  assert.equal(worstCaseGptOssMicroUsd(messages,900,50000),null);
  assert.ok(worstCaseGptOssMicroUsd(messages,900,9000)>cap);
  assert.equal(worstCaseGptOssMicroUsd([{role:"user",content:"x".repeat(50000)}],500),null);
  const trace=[];
  const state={spent:0,cap:250000};
  const db={prepare:()=>({bind(...values){return {async first(){const amount=Number(values[2]),limit=Number(values[4]);if(state.spent+amount>limit)return null;state.spent+=amount;return {units:state.spent}}};}})};
  const env={DB:db,MODEL_TRACE:trace,BOR_GPT_OSS_DAILY_USD_LIMIT:"0.25"};
  assert.equal((await reserveGptOssCall(env,messages,900)).allowed,true);
  assert.equal((await reserveGptOssCall(env,messages,900)).allowed,true);
  assert.equal((await reserveGptOssCall(env,messages,900)).reason,"per_turn_cap");
  assert.equal(trace.gptOssReservedCalls,2);
  assert.equal((await reserveGptOssCall({MODEL_TRACE:[]},messages,500)).allowed,false);
  assert.equal((await reserveGptOssCall({...env,MODEL_TRACE:[],BOR_GPT_OSS_DAILY_USD_LIMIT:"11"},messages,500)).reason,"invalid_limit");
  assert.equal((await reserveGptOssCall({...env,MODEL_TRACE:[],BOR_GPT_OSS_DAILY_USD_LIMIT:"0"},messages,500)).reason,"invalid_limit");
  assert.equal((await reserveGptOssCall({...env,MODEL_TRACE:[],BOR_GPT_OSS_DAILY_USD_LIMIT:"0.000001"},messages,500)).reason,"invalid_limit");
});
test("model output parsing excludes hidden reasoning and safely extracts user-facing text",()=>{
  assert.equal(extractModelAnswer({response:"Final answer"}),"Final answer");
  assert.equal(extractModelAnswer({output:[{type:"reasoning",summary:[{text:"Private reasoning"}]},{type:"message",content:[{type:"output_text",text:"Safe final"}]}]}),"Safe final");
  assert.equal(extractModelAnswer({output:[{type:"reasoning",content:[{type:"output_text",text:"hidden"}]}]}),"");
  assert.equal(extractModelAnswer({}),"");
});
test("auto search uses high-confidence freshness; static and credential-bearing prompts stay local",()=>{
  assert.equal(detectResearchMode("Who is the CEO of Microsoft?"),"web");
  assert.equal(detectResearchMode("Siapa presiden Amerika Serikat?"),"web");
  assert.equal(detectResearchMode("Kapan jadwal rilis versi terbarunya?"),"web");
  assert.equal(detectResearchMode("Cari berita pasar saham hari ini"),"news");
  assert.equal(detectResearchMode("Tuliskan puisi tentang keindahan alam"),null);
  assert.equal(detectResearchMode("Berapa hasil 12 x 14?"),null);
  assert.equal(detectResearchMode("cari info terbaru api_key=SUPERPRIVATESECRET1234"),null);
});
test("Google Forms workflow produces an explicit user-run draft, never an actual form or OAuth token",()=>{
  const draft=planFeedbackForm("Buatkan formulir feedback dan saran publik untuk BOR AI");
  assert.equal(draft.title,"BOR AI — Masukan & Saran Publik");
  assert.equal(draft.items.length,8);
  assert.equal(planFeedbackForm("Tolong cek situs web terbaru"),null);
  const script=generateFormsScript(draft);
  assert.match(script,/FormApp\.create/);
  assert.match(script,/setCollectEmail\(false\)/);
  assert.match(script,/getPublishedUrl\(\)/);
  assert.match(script,/reviewing it/);
  assert.doesNotMatch(script,/fetch\(|UrlFetchApp|API_KEY|password\s*=/);
  assert.throws(()=>generateFormsScript({kind:"google-forms-apps-script",title:"A",items:[{type:"invalid",title:"X",required:false}]}),/invalid_form_item/);
});
test("production model config documents hard USD cap, no remote provider secrets",()=>{
 const cfg=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
 assert.equal(cfg.vars.BOR_GPT_OSS_ENABLED,"true");
 assert.equal(cfg.vars.BOR_GPT_OSS_DAILY_USD_LIMIT,"0.25");
 assert.equal(Object.hasOwn(cfg.vars,"CLOUDFLARE_API_TOKEN"),false);
});

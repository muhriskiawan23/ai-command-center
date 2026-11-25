import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/luna-staging-worker.js";
import { sha256Hex } from "../src/http.js";
import { stagingSearchReceipt } from "../src/luna-staging-search-receipt.js";
const url = "https://staging.example/__staging-search-smoke";
const token = "a".repeat(64);
const env = async () => ({BOR_LUNA_STAGING_WEB_SEARCH_ENABLED:"true",
  BOR_LUNA_SEARCH_SMOKE_TRIGGER_DIGEST:await sha256Hex(token),
  BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT:String(Date.now()+60000)});
const get = (headers={}) => new Request(url,{headers});
const post = (headers={}) => new Request(url,{method:"POST",headers});
test("bridge defaults off and expired or excessive windows fail closed",async()=>{
  const e=await env();
  for(const v of [{}, {...e,BOR_WEB_SEARCH_KILL_SWITCH:"true"}, {...e,BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT:"0"}, {...e,BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT:String(Date.now()+600000)}]){
    assert.equal((await worker.fetch(get({"X-BOR-Staging-Smoke":token}),v)).status,404);
  }
});
test("bridge rejects missing and wrong one-time headers",async()=>{
  const e=await env();
  assert.equal((await worker.fetch(get(),e)).status,401);
  assert.equal((await worker.fetch(get({"X-BOR-Staging-Smoke":"b".repeat(64)}),e)).status,401);
});
test("authorized GET exposes no credential and never touches DB or provider",async()=>{
  const e={...await env(),DB:{prepare(){assert.fail("GET touched DB")}}};
  const r=await worker.fetch(get({"X-BOR-Staging-Smoke":token}),e);
  assert.equal(r.status,200);
  const page=await r.text();
  assert.match(page,/method:"POST"/);
  assert.ok(!page.includes(token));
  assert.match(r.headers.get("Content-Security-Policy"),/connect-src 'self'/);
});
test("POST requires exact same origin and explicit intent before admission",async()=>{
  const e={...await env(),DB:{prepare(){assert.fail("unauthorized POST touched DB")}}};
  const headers={"X-BOR-Staging-Smoke":token};
  for(const h of [headers,{...headers,Origin:"https://other.example","X-BOR-Smoke-Intent":"once"},{...headers,Origin:"https://staging.example"}]){
    assert.equal((await worker.fetch(post(h),e)).status,404);
  }
  assert.equal((await worker.fetch(post({...headers,Origin:"https://staging.example","X-BOR-Smoke-Intent":"once"}),e)).status,503);
});
test("billable search count remains separate from tool item count when provided",()=>{
  const data={status:"completed",model:"gpt-6-luna",usage:{input_tokens:100,output_tokens:10},output:[{type:"web_search_call"}],tool_usage:{web_search:{num_requests:2}}};
  const r=stagingSearchReceipt(Response.json({}),data);
  assert.equal(r.usage.webCalls,1);
  assert.equal(r.usage.billedWebRequests,2);
});

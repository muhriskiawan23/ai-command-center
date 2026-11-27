import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import worker from "../src/index.js";
import { COMMUNICATION_NOTICE } from "../src/prompts.js";
import { planWebSearch } from "../src/web-search-v2.js";
import { createD1, seedSession, seedConversation } from "./e2e/harness.js";

const prior = "Target: retain ownership. " + "Background information. ".repeat(250) + " Correction: no paid advertising and keep budget at zero.";
const oldAnswer = "Initial proposal. " + "Explanation. ".repeat(400) + " Final decision: use organic channels only.";
const messages = [{role:"user",content:prior},{role:"assistant",content:oldAnswer}];
const origin = "https://bor.example";
const fixture = "A synthetic answer with enough meaningful content for the chat request.";
async function requestHistory(history, extraEnv={}, body={}, token) {
  let captured;
  const response = await worker.fetch(new Request(origin+"/api/chat", {method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(token?{Cookie:"__Host-borai_session="+token}:{})},body:JSON.stringify({message:"Please revise the wording only.",language:"en",history,...body})}), {...extraEnv,BOR_WEB_SEARCH_MODE:"off",AI:{run:async(_model,payload)=>{captured=payload.messages;return {response:fixture}}}});
  assert.equal(response.status,200);
  assert.ok(captured);
  return captured.filter(m=>m.role!=="system").slice(0,-1);
}
function assertExcerpt(result) {
  assert.equal(result.length,2);
  assert.match(result[0].content,/^Target: retain ownership\./);
  assert.match(result[0].content,/Correction: no paid advertising and keep budget at zero\.$/);
  assert.match(result[1].content,/Final decision: use organic channels only\.$/);
  assert.ok(result.every(m=>m.content.length<=2000 && m.content.includes("middle omitted")));
}
test("guest retains beginning and end of long prior turns inside unchanged bounds",async()=>{
  assertExcerpt(await requestHistory(messages));
});
test("authenticated context retains end corrections from owned D1 rows and ignores client forgery",async()=>{
  const DB=createD1();
  try {
    const token=seedSession(DB,{id:"owner-fixture",email:"owner@example.invalid"});
    seedConversation(DB,{id:"conv-context-fixture",userId:"owner-fixture",title:"fixture",updatedAt:100,messages});
    const result=await requestHistory([{role:"user",content:"FORGED"}],{DB},{conversationId:"conv-context-fixture"},token);
    assertExcerpt(result);assert.ok(!JSON.stringify(result).includes("FORGED"));
  } finally {DB.sqlite.close()}
});
test("browser guest excerpt matches worker and never splits surrogate pairs",async()=>{
  const source=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const start=source.indexOf("function historyExcerpt(");
  const end=source.indexOf("/* Kebijakan kegagalan:",start);
  assert.ok(start>=0&&end>start);
  const context=vm.createContext({});vm.runInContext(source.slice(start,end),context);
  const output=JSON.parse(JSON.stringify(context.buildHistory({messages})));
  assertExcerpt(output);assert.deepEqual(output,await requestHistory(messages));
  const emoji="🚀".repeat(1500);
  const excerpt=context.historyExcerpt(emoji);
  assert.ok(excerpt.length<=2000);
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(excerpt)),excerpt);
  assert.equal(context.historyExcerpt(" Short exact content. "),"Short exact content.");
});
test("history retains bounded latest turns and does not insert more than 8000 characters",async()=>{
  const history=Array.from({length:12},(_,i)=>({role:i%2?"assistant":"user",content:`begin-${i} `+"a".repeat(3500)+` end-${i}`}));
  const result=await requestHistory(history);
  assert.ok(result.length<=12&&result.length>=2);
  assert.equal(result[0].role,"user");assert.match(result.at(-1).content,/end-11$/);
  assert.ok(result.reduce((sum,m)=>sum+m.content.length,0)<=8000);
});
test("quality instructions explicitly handle revisions, arithmetic, evidence and obscure public research",async()=>{
  assert.match(COMMUNICATION_NOTICE,/latest explicit correction wins/);
  assert.match(COMMUNICATION_NOTICE,/check arithmetic, units, denominators/);
  assert.match(COMMUNICATION_NOTICE,/do not invent its missing text/);
  let calls=0;
  const plan=await planWebSearch({run:async(_model,payload)=>{calls++;const instruction=payload.messages[0].content;assert.match(instruction,/obscure or highly specific public factual claims/);assert.match(instruction,/newest explicit correction takes precedence/);return {response:JSON.stringify({search:true,category:"general",query:"Find the official publication for the synthetic historical fact."})}}},"Find the official publication for the synthetic historical fact.");
  assert.ok(plan);assert.equal(calls,1);
});

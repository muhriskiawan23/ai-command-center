import test from "node:test";
import assert from "node:assert/strict";
import { planWebSearch, runWebSearchV2 } from "../src/web-search-v2.js";
import { COMMUNICATION_NOTICE } from "../src/prompts.js";
import { createD1 } from "./e2e/harness.js";

const question = "For a synthetic sample mission, give the initial mass, added mass, total, announcement date and technical cause, with official citations.";
const answer = "Initial mass: 70 g. Added mass: 50 g. Total: 120 g. Announcement: 15 February. Cause: two stuck fasteners.";
test("public search task requests all subquestions, keeps quota and canonicalizes tracking citations", async () => {
  let classifierCalls=0, providerCalls=0;
  const plan=await planWebSearch({async run(_model,body){
    classifierCalls++;
    assert.match(body.messages[0].content,/EVERY requested subquestion/);
    return {response:JSON.stringify({search:true,category:"general",query:question,queries:["synthetic sample mass and fasteners"]})};
  }}, question);
  assert.equal(plan.query,question);
  const env={
    DB:createD1(), BOR_WEB_SEARCH_MODE:"v2", BOR_WEB_SEARCH_PILOT_USER_IDS:"pilot",
    BOR_WEB_SEARCH_USER_DAILY_CALLS:"1", BOR_WEB_SEARCH_DAILY_CALLS:"1",
    BOR_WEB_SEARCH_DAILY_MICRO_USD:"260000", BOR_WEB_SEARCH_MONTHLY_MICRO_USD:"260000",
    BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD:"260000", BOR_WEB_SEARCH_OPENAI_KEY:"mock",
    async WEB_SEARCH_V2_FETCHER(_url, options){
      providerCalls++;
      const body=JSON.parse(options.body);
      assert.equal(JSON.parse(body.input).question,question);
      assert.match(body.instructions,/explicitly answer each/);
      assert.match(body.instructions,/Do not replace a requested amount, date or cause/);
      assert.equal(body.max_output_tokens,2000);
      assert.equal(body.max_tool_calls,2);
      assert.equal(body.store,false);
      assert.equal(body.tools[0].search_context_size,"low");
      return Response.json({status:"completed",output:[
        {type:"web_search_call",status:"completed"},
        {type:"message",role:"assistant",content:[{type:"output_text",text:answer,annotations:[
          {type:"url_citation",url:"https://example.com/report?utm_source=openai&id=42",title:"Report",start_index:0,end_index:answer.length},
          {type:"url_citation",url:"https://example.com/report?id=42",title:"Report",start_index:0,end_index:answer.length},
          {type:"url_citation",url:"https://example.com/report?id=43",title:"Other report",start_index:0,end_index:answer.length},
          {type:"url_citation",url:"https://example.com/report?token=secret&utm_source=openai",title:"Private",start_index:0,end_index:answer.length}
        ]}]}
      ]});
    }
  };
  const result=await runWebSearchV2(env,plan,{userId:"pilot",now:Date.UTC(2026,10,26)});
  assert.equal(classifierCalls,1);
  assert.equal(providerCalls,1);
  assert.ok(result.text.startsWith(answer));
  assert.deepEqual(result.links.map(x=>x.url),["https://example.com/report?id=42","https://example.com/report?id=43"]);
  assert.equal((result.text.match(/⟦1⟧/g)||[]).length,1);
  assert.equal(await runWebSearchV2(env,plan,{userId:"pilot",now:Date.UTC(2026,10,26)}),null);
  assert.equal(providerCalls,1);
  assert.match(COMMUNICATION_NOTICE,/answer every explicit subquestion/);
});

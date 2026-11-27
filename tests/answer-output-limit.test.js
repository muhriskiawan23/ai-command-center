import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { isOutputTokenLimited } from '../src/gpt-oss.js';
import { withTextProviderFailover } from '../src/text-provider-failover.js';
import { DEFAULT_MODEL_ID } from '../src/model-gateway.js';

test('only explicit provider output-limit signals mark incomplete output', () => {
  assert.equal(isOutputTokenLimited({choices:[{finish_reason:'length'}]}),true);
  assert.equal(isOutputTokenLimited({result:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}}),true);
  for (const value of [{response:'length'},{choices:[{finish_reason:'stop'}]},{status:'incomplete',incomplete_details:{reason:'content_filter'}},null]) assert.equal(isOutputTokenLimited(value),false);
});
test('Luna adapter retains explicit length marker without changing existing budget or output',async()=>{
  let calls=0;
  const env=withTextProviderFailover({BOR_TEXT_BACKUP_ENABLED:'true',BOR_TEXT_LUNA_PRIMARY:'true',BOR_TEXT_BACKUP_API_KEY:'mock',BOR_TEXT_BACKUP_DAILY_USD_LIMIT:'1',DB:{prepare:()=>({bind:()=>({first:async()=>({units:100})})})},AI:{run:async()=>{throw Error('unexpected fallback')}}},async(_url,req)=>{
    calls++;const body=JSON.parse(req.body);assert.equal(body.max_completion_tokens,200);assert.equal(body.reasoning_effort,'none');assert.equal(body.store,false);
    return Response.json({choices:[{finish_reason:'length',message:{role:'assistant',content:'Partial text'}}]});
  });
  const result=await env.AI.run(DEFAULT_MODEL_ID,{messages:[{role:'user',content:'fixture'}],max_tokens:200});
  assert.equal(result.response,'Partial text');assert.ok(isOutputTokenLimited(result));assert.equal(calls,1);
});
test('chat discloses known truncation without a second inference; completed output remains untouched',async()=>{
  for(const finish_reason of ['length','stop']){
    let calls=0;
    const text='Ini adalah jawaban parsial yang berisi beberapa detail penting untuk pengguna.';
    const response=await worker.fetch(new Request('https://bor.example/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Jelaskan energi surya.',language:'id'})}),{BOR_WEB_SEARCH_MODE:'off',AI:{run:async()=>{calls++;return {choices:[{finish_reason,message:{role:'assistant',content:text}}]}}}});
    assert.equal(response.status,200);const body=await response.json();assert.equal(calls,1);assert.equal(body.response,finish_reason==='length'?'**Jawaban belum lengkap:** model mencapai batas keluaran. Sebagian detail mungkin belum tercakup.\n\n'+text:text);assert.equal(body.agentModels[0].outcome,finish_reason==='length'?'partial':'success');
  }
});

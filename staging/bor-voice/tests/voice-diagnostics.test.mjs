import test from 'node:test';
import assert from 'node:assert/strict';
import {httpDiagnostic,providerHttpError,usageEvidence,settlementEvidence} from '../voice-diagnostics.mjs';
test('503 retains only allowlisted metadata and no secret or raw body',()=>{
 const r=new Response('private body',{status:503,headers:{'retry-after':'15','x-request-id':'req_fixture',authorization:'Bearer secret'}});
 const d=httpDiagnostic(r,'attach',123);
 assert.deepEqual(d,{phase:'attach',observedMs:123,httpStatus:503,requestId:'req_fixture',retryAfter:'15'});
 assert.equal(providerHttpError('failed',r,'attach').upstreamStatus,503);
 assert.equal(JSON.stringify(d).includes('secret'),false);
 assert.equal(httpDiagnostic({status:503,headers:{get:()=> 'sk-secret'}},'attach',123).requestId,null);
});
test('usage snapshots are monotonic and terminal evidence requires matching identity',()=>{
 const id='live_fixture', session={id,model:'gpt-live-1.1'};
 const a=usageEvidence(null,{type:'session.usage.updated',usage:{seconds:12}},id,100);
 assert.equal(a.seconds,12);assert.equal(a.terminal,false);
 assert.equal(usageEvidence(a,{type:'session.usage.updated',usage:{seconds:2}},id,101),a);
 assert.equal(usageEvidence(a,{type:'session.closed',session:{...session,id:'live_wrong'},usage:{seconds:20}},id,102),a);
 const b=usageEvidence(a,{type:'session.closed',session,reason:'connection_lost',usage:{seconds:20}},id,103);
 assert.equal(b.terminal,true);assert.equal(b.endReason,'connection_lost');
 assert.equal(usageEvidence(b,{type:'session.usage.updated',usage:{seconds:21}},id,104),b);
});
test('unconfirmed evidence preserves the reservation and distinguishes missing from zero',()=>{
 const row={state:'reserved',reservedMicrousd:100000};
 const result=settlementEvidence(row,{sessionId:'live_fixture',latestSeconds:12,startedMs:100,endedMs:200,diagnostic:{phase:'attach',httpStatus:503,requestId:'req_fixture',retryAfter:'15',observedMs:200,raw:'secret'}});
 assert.equal(result.state,'reserved');assert.equal(result.reservedMicrousd,100000);assert.equal(result.latestSeconds,12);
 assert.equal(result.diagnostic.raw,undefined);assert.equal(result.sessionId,'live_fixture');
 assert.equal(settlementEvidence(row,{latestSeconds:null}).latestSeconds,undefined);
 assert.equal(settlementEvidence(row,{latestSeconds:0}).latestSeconds,0);
});

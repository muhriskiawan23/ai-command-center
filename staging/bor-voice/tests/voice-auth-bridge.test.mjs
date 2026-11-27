import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceAdmissionStatus } from '../voice-admission.mjs';
const req = new Request('https://app.getborai.com/api/voice/admission/status',{headers:{cookie:'fixture-only','x-user-id':'forged'}});
const json=(body,status=200)=>({body,status});
const getSession=async()=>({id:'trusted-fixture'});
const call=(request,env,session=getSession)=>voiceAdmissionStatus(request,env,{getSession:session,json});
test('guest and failed Google session never reach service binding',async()=>{
 let calls=0;const env={BOR_VOICE_STATUS:{fetch:async()=>{calls++;return Response.json({state:'available'});}}};
 assert.equal((await call(req,env,async()=>null)).status,401);
 assert.equal((await call(req,env,async()=>{throw Error('fixture');})).status,503);
 assert.equal(calls,0);
});
test('private status binding does not receive cookie or identity',async()=>{
 let calls=0;const env={BOR_VOICE_STATUS:{fetch:async(url,init)=>{
 calls++;assert.equal(url,'https://voice-status.internal/api/voice/session/status');
 assert.equal(init.method,'GET');assert.equal(init.headers,undefined);assert.equal(init.body,undefined);
 return Response.json({state:'pilot_session_unconfirmed',unexpected:'private-fixture'});
 }}};
 const r=await call(req,env);assert.equal(r.status,200);assert.equal(calls,1);
 assert.equal(r.body.authenticated,true);assert.equal(r.body.ready,false);
 assert.equal(r.body.sessionState,'pilot_session_unconfirmed');
 assert.ok(!JSON.stringify(r.body).includes('trusted-fixture'));assert.ok(!JSON.stringify(r.body).includes('private-fixture'));
});
test('no binding or available provider never enables paid admission',async()=>{
 assert.equal((await call(req,{})).body.ready,false);
 assert.equal((await call(req,{BOR_VOICE_STATUS:{fetch:async()=>Response.json({state:'available'})}})).body.ready,false);
});
test('unknown state, oversized body and network failure fail closed',async()=>{
 for(const fetch of [async()=>Response.json({state:'unknown'}),async()=>new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}),async()=>{throw Error('fixture');}]){
 const r=await call(req,{BOR_VOICE_STATUS:{fetch}});assert.equal(r.status,503);assert.equal(r.body.ready,false);
 }
});
test('POST cannot reserve or forward a session',async()=>{
 let calls=0;const r=await call(new Request(req.url,{method:'POST'}),{BOR_VOICE_STATUS:{fetch:async()=>{calls++;}}});
 assert.equal(r.status,405);assert.equal(calls,0);
});

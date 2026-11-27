import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePrimaryEvidence,makeEvidenceWriter,makeOwnerEvidenceExport} from '../primary-evidence.mjs';
import {createPrimaryLedger} from '../primary-ledger.mjs';
const base={sessionId:'live_fixture',startedMs:100,observedMs:101,latestSeconds:null};
test('identity survives restart and stale evidence cannot overwrite usage',()=>{
 const row=mergePrimaryEvidence({state:'reserved',reservedMicrousd:100000},base);
 const saved=mergePrimaryEvidence(row,{...base,observedMs:103,latestSeconds:9});
 assert.equal(saved.sessionId,base.sessionId);assert.equal(saved.latestSeconds,9);
 assert.equal(mergePrimaryEvidence(saved,{...base,latestSeconds:3}),saved);
 assert.throws(()=>mergePrimaryEvidence(saved,{...base,sessionId:'live_other'}));
 assert.equal(saved.reservedMicrousd,100000);
});
test('queue coalesces snapshots, flushes before settlement and fails closed',async()=>{
 let release;const gate=new Promise(r=>release=r);const writes=[],tasks=[];
 const w=makeEvidenceWriter({write:async s=>{writes.push(s);await gate;return true},waitUntil:p=>tasks.push(p),onFailure:()=>assert.fail()});
 w.offer(base);await Promise.resolve();w.offer({...base,latestSeconds:1});w.offer({...base,latestSeconds:2});release();
 assert.equal(await w.drain(),true);assert.equal(writes.length,2);assert.equal(writes[1].latestSeconds,2);
 let failed=0;const bad=makeEvidenceWriter({write:async()=>false,waitUntil:()=>{},onFailure:()=>failed++});
 bad.offer(base);assert.equal(await bad.drain(),false);assert.equal(failed,1);
});
test('persisted usage guards settlement and remains available after restart',async()=>{
 const data=new Map(),storage={transaction:async fn=>fn({get:async k=>data.get(k),put:async(k,v)=>data.set(k,structuredClone(v))})};
 const setup=()=>createPrimaryLedger({storage,assessExposure:()=>({allowed:true}),providerMaxSeconds:120,now:()=>1000});
 const attemptId='test-attempt-0001';
 await setup().reserve({attemptId,userId:'owner'});
 await setup().recordEvidence({attemptId,...base,latestSeconds:9});
 const persisted=(await setup().readEvidenceRows())[0];assert.equal(persisted.latestSeconds,9);
 const settled=await setup().settle({attemptId,confirmed:true,sessionId:base.sessionId,startedMs:100,latestSeconds:2,usage:{seconds:3}});
 assert.equal(settled.state,'unconfirmed');assert.equal(settled.latestSeconds,9);assert.equal(settled.reservedMicrousd,100000);
});
test('owner export denies other users and never returns arbitrary stored fields',async()=>{
 let user={id:'guest'},reads=0;
 const origin='https://example.test';
 const handle=makeOwnerEvidenceExport({origin,ownerId:'owner',getSession:async()=>user,readRows:async()=>{reads++;return [{state:'reserved',attemptId:'test-attempt-0001',sessionId:'live_fixture',latestSeconds:0,userId:'owner',secret:'secret'}]}});
 const req=()=>new Request(origin+'/api/voice/diagnostics');
 assert.equal((await handle(req())).status,403);assert.equal(reads,0);
 user={id:'owner'};const response=await handle(req());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const body=await response.json();assert.equal(body.records[0].latestSeconds,0);assert.equal(body.records[0].secret,undefined);assert.equal(body.records[0].userId,undefined);
 assert.equal((await handle(new Request(origin+'/api/voice/diagnostics',{method:'POST'}))).status,405);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PilotLedger} from '../budget.mjs';
import {OfflinePilot} from '../pilot.mjs';
const sdp='v=0\r\ns=test\r\n';
const answer={session:{id:'live_late'},transport:{type:'webrtc',sdp}};
function fixture(t,create){const ledger=new PilotLedger(':memory:');t.after(()=>ledger.close());const calls=[];const pilot=new OfflinePilot({ledger,clock:()=>1000,schedule:()=>1,cancel:()=>{},createWaitMs:15,closeWaitMs:15,simulation:{create,hangup:async id=>(calls.push(id),true)}});return {pilot,ledger,calls};}
const bounded=p=>Promise.race([p.then(()=> 'resolved', e=>e.message),new Promise(r=>setTimeout(()=>r('test_timeout'),100))]);
test('non-returning create releases caller but keeps reservation locked',async t=>{const f=fixture(t,()=>new Promise(()=>{}));assert.equal(await bounded(f.pilot.start('a',sdp)),'create_timeout');assert.equal(f.pilot.status().blocked,true);await assert.rejects(f.pilot.start('b',sdp));});
test('late successful create is never exposed and is closed after timeout',async t=>{let resolve;const f=fixture(t,()=>new Promise(r=>resolve=r));assert.equal(await bounded(f.pilot.start('a',sdp)),'create_timeout');resolve(answer);await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,['live_late']);assert.equal(f.pilot.journal.pending()[0].provider_id,'live_late');assert.equal(f.pilot.status().blocked,true);});
test('late rejection after timeout does not unlock the ledger',async t=>{let reject;const f=fixture(t,()=>new Promise((_,r)=>reject=r));assert.equal(await bounded(f.pilot.start('a',sdp)),'create_timeout');reject(Error('transport failed'));await new Promise(r=>setImmediate(r));assert.equal(f.pilot.status().blocked,true);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {makePrimaryGateway} from '../primary-gateway.mjs';
import {createPrimaryVoice} from '../primary-voice.mjs';
import {createPrimaryLedger} from '../primary-ledger.mjs';
const origin='https://example.test',session={id:'live_fixture',model:'gpt-live-1.1'};
class Socket extends EventTarget{
 readyState=1;sent=[];
 send(value){this.sent.push(JSON.parse(value));}
 receive(event){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(event)}));}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
function fixture({failWrite=false,missingWriter=false}={}){
 const data=new Map(),tasks=[];let tail=Promise.resolve(),connects=0;
 const storage={transaction(fn){const next=tail.then(()=>fn({get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v))}));tail=next.catch(()=>{});return next;}};
 const ledger=createPrimaryLedger({storage,assessExposure:()=>({allowed:true}),providerMaxSeconds:120});
 const client=new Socket(),provider=new Socket();
 const start=makePrimaryGateway({getSession:async()=>({id:'owner'}),ownerId:'owner',origin,enabled:true,reserve:ledger.reserve,connect:async()=>{connects++;return provider},createVoice:createPrimaryVoice,settle:ledger.settle,recordEvidence:missingWriter?undefined:failWrite?async()=>false:ledger.recordEvidence,waitUntil:p=>tasks.push(p),randomId:()=> 'test-attempt-0001'});
 return {client,provider,ledger,start:()=>start(new Request(origin,{headers:{Origin:origin,Upgrade:'websocket'}}),client),flush:async()=>{for(let i=0;i<tasks.length;i++)await tasks[i]},connects:()=>connects};
}
test('gateway persists identity and usage before disconnect, preserves unconfirmed reservation',async()=>{
 const f=fixture();assert.equal((await f.start()).ok,true);
 f.provider.receive({type:'session.started',session});
 f.provider.receive({type:'session.usage.updated',usage:{seconds:8}});
 await f.flush();let [row]=await f.ledger.readEvidenceRows();assert.equal(row.sessionId,session.id);assert.equal(row.latestSeconds,8);assert.equal(row.state,'reserved');
 f.provider.close();await f.flush();[row]=await f.ledger.readEvidenceRows();assert.equal(row.state,'unconfirmed');assert.equal(row.latestSeconds,8);assert.equal(row.reservedMicrousd,100000);assert.equal(row.finalSeconds,undefined);
});
test('valid finalization keeps last snapshot and final seconds separate',async()=>{
 const f=fixture();await f.start();f.provider.receive({type:'session.started',session});
 f.provider.receive({type:'session.usage.updated',usage:{seconds:8}});
 f.provider.receive({type:'session.closed',session,usage:{seconds:11},reason:'expired'});await f.flush();
 const [row]=await f.ledger.readEvidenceRows();assert.equal(row.state,'closed');assert.equal(row.latestSeconds,8);assert.equal(row.finalSeconds,11);assert.equal(row.endReason,'expired');assert.equal(f.client.sent.at(-1).confirmed,true);
});
test('failed evidence write asks for close and cannot confirm settlement',async()=>{
 const f=fixture({failWrite:true});await f.start();f.provider.receive({type:'session.started',session});await f.flush();
 assert.equal(f.provider.sent.at(-1).type,'session.close');
 f.provider.receive({type:'session.closed',session,usage:{seconds:11},reason:'expired'});await f.flush();
 const [row]=await f.ledger.readEvidenceRows();assert.equal(row.state,'unconfirmed');assert.equal(row.reservedMicrousd,100000);assert.equal(f.client.sent.at(-1).confirmed,false);
});
test('missing journal wiring blocks connection before reservation',async()=>{
 const f=fixture({missingWriter:true});assert.equal((await f.start()).reason,'evidence_unavailable');assert.equal(f.connects(),0);assert.deepEqual(await f.ledger.readEvidenceRows(),[]);
});

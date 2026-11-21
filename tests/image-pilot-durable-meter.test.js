import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {processImageJob} from '../src/image-jobs.js';
import {createD1,seedSession} from './e2e/harness.js';

const validPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGMUaTrxnwEJMDGgAcICAJqcAmUgQSjSAAAAAElFTkSuQmCC','base64');
const okImage=()=>Response.json({data:[{b64_json:validPng.toString('base64')}],usage:{input_tokens:5,output_tokens:10,total_tokens:15}});
function setup(limit='10'){
  const db=createD1();
  const user={id:'first-owner',email:'first@example.test'};
  const token=seedSession(db,user);
  db.sqlite.prepare('INSERT INTO image_wallets VALUES(?,?,?)').run(user.id,100,1);
  const stored=new Map();const providerCalls=[];
  const env={DB:db,BOR_IMAGES_ENABLED:'true',OPENAI_API_KEY:'fake-local-key',
    IMAGE_CREDITS_GENERATE:'10',IMAGE_CREDITS_EDIT:'12',IMAGE_TARIFF_VERSION:'synthetic-v1',
    IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:limit,OPENAI_IMAGE_MODEL:'gpt-image-2',IMAGE_PILOT_QUALITY:'low',
    CHAT_LIMITER:{limit:async()=>({success:true})},
    IMAGE_FILES:{put:async(k,bytes)=>stored.set(k,Buffer.from(bytes)),get:async k=>stored.has(k)?{arrayBuffer:async()=>stored.get(k)}:null,
      delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])stored.delete(key);}},
    IMAGE_QUEUE:{send:async()=>{}},
    IMAGE_FETCHER:async(url,opts)=>{providerCalls.push({url,opts});return okImage();}};
  const create=(who=token)=>worker.fetch(new Request('https://bor.test/api/images/jobs',{method:'POST',
    headers:{Cookie:'__Host-borai_session='+who,Origin:'https://bor.test','Content-Type':'application/json'},
    body:JSON.stringify({mode:'generate',prompt:'poster local',tariffVersion:'synthetic-v1',maxCredits:10,requestId:crypto.randomUUID()})}),env);
  const config=()=>worker.fetch(new Request('https://bor.test/api/images/config'),env);
  const addUser=(id,email)=>{const newToken=seedSession(db,{id,email});db.sqlite.prepare('INSERT INTO image_wallets VALUES(?,?,?)').run(id,100,1);return newToken;};
  const meter=()=>db.sqlite.prepare('SELECT * FROM image_pilot_meter WHERE singleton=1').get();
  return {db,env,token,user,create,config,addUser,meter,stored,providerCalls,close:()=>db.sqlite.close()};
}
test('lifetime cap survives account deletion and does not preserve personal identifiers',async()=>{
  const h=setup('1');try{
    const first=await h.create();assert.equal(first.status,202);
    assert.equal(h.meter().admitted_count,1);
    h.db.sqlite.prepare('DELETE FROM users WHERE id=?').run(h.user.id);
    assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM image_jobs').get().n,0);
    assert.equal(h.db.sqlite.prepare('SELECT admitted_count FROM image_pilot_meter').get().admitted_count,1);
    assert.deepEqual(Object.keys(h.meter()).sort(),['admitted_count','provider_hold','singleton','unsettled_calls','updated_at']);
    const next=h.addUser('new-owner','new@example.test');
    assert.equal((await h.create(next)).status,429);
    assert.equal(h.providerCalls.length,0);
  }finally{h.close();}
});
test('provider timeout persists billing hold after its user and job are deleted',async()=>{
  const h=setup();try{
    h.env.IMAGE_FETCHER=async()=>{h.providerCalls.push('attempt');throw Error('private provider timeout');};
    const job=(await (await h.create()).json());
    await processImageJob(h.env,job.id);
    assert.equal(h.meter().provider_hold,1);
    assert.equal(h.meter().unsettled_calls,1);
    assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,100);
    h.db.sqlite.prepare('DELETE FROM users WHERE id=?').run(h.user.id);
    const next=h.addUser('second-owner','second@example.test');
    assert.equal((await h.create(next)).status,503);
    assert.equal((await (await h.config()).json()).unavailableReason,'billing_reconciliation_pending');
    assert.equal(h.providerCalls.length,1);
  }finally{h.close();}
});
test('inflight provider call blocks concurrent paid admission and clears only after durable completion',async()=>{
  const h=setup();try{
    let release;let notify;
    const entered=new Promise(resolve=>{notify=resolve;});
    h.env.IMAGE_FETCHER=async()=>{notify();return await new Promise(resolve=>{release=resolve;});};
    const job=(await (await h.create()).json());
    const processing=processImageJob(h.env,job.id);
    await entered;
    assert.equal(h.meter().unsettled_calls,1);
    assert.equal((await h.create()).status,503);
    assert.equal((await (await h.config()).json()).unavailableReason,'image_pilot_in_flight');
    release(okImage());
    await processing;
    assert.equal(h.meter().unsettled_calls,0);
    assert.equal(h.meter().provider_hold,0);
    assert.equal((await h.create()).status,202);
  }finally{h.close();}
});
test('account deletion during provider call cannot erase outstanding billing evidence',async()=>{
  const h=setup();try{
    let release;let notify;
    const entered=new Promise(resolve=>{notify=resolve;});
    h.env.IMAGE_FETCHER=async()=>{notify();return await new Promise(resolve=>{release=resolve;});};
    const job=(await (await h.create()).json());
    const processing=processImageJob(h.env,job.id);
    await entered;
    h.db.sqlite.prepare('DELETE FROM users WHERE id=?').run(h.user.id);
    release(okImage());
    await processing;
    assert.equal(h.meter().admitted_count,1);
    assert.equal(h.meter().provider_hold,1);
    const next=h.addUser('post-delete-owner','post-delete@example.test');
    assert.equal((await h.create(next)).status,503);
  }finally{h.close();}
});
test('missing global meter fails closed before any API call, even with a valid user wallet',async()=>{
 const h=setup();try{
   h.db.sqlite.exec('DROP TRIGGER image_pilot_admit; DROP TRIGGER image_pilot_hold; DELETE FROM image_pilot_meter');
   assert.equal((await h.create()).status,500); // fail-closed server error; no image/credit writes
   assert.equal(h.providerCalls.length,0);
   assert.equal((await (await h.config()).json()).enabled,false);
 }finally{h.close();}
});

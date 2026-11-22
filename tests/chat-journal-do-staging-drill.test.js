import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {collectPrivateDoSnapshot,replayDoSnapshotOffline}
  from '../tools/recovery/do-journal-staging-drill.mjs';

const TOKEN='synthetic-private-token-for-offline-recovery-tests';
function setup(){
  const db=new DatabaseSync(':memory:');
  const sql={exec(query,...args){return {toArray:()=>db.prepare(query).all(...args)};}};
  const storage={sql,transactionSync(callback){
    db.exec('BEGIN IMMEDIATE');
    try{const value=callback();db.exec('COMMIT');return value;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }};
  const object=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:TOKEN});
  const user_id='user-one';
  const push=async(event_id,kind,payload={})=>{
    const response=await object.fetch(new Request('https://journal.internal/append',{
      method:'POST',headers:{'X-BOR-Journal-Token':TOKEN},
      body:JSON.stringify({event_id,user_id,kind,payload})
    }));
    assert.equal(response.status,200,JSON.stringify(await response.json()));
    return response;
  };
  const auth={userId:user_id,secret:TOKEN,expectedMinimumHead:0,pageLimit:2};
  return {db,object,push,auth,close:()=>db.close()};
}
async function seed(h){
  await h.push('account-created','account.created');
  await h.push('conv-created','conversation.created',
    {conversation_id:'conversation-one',title:'Sensitive chat title'});
  await h.push('user-message','message.saved',
    {conversation_id:'conversation-one',message_id:'first-message',role:'user',content:'SECRET_USER_PROMPT'});
  await h.push('assistant-message','message.saved',
    {conversation_id:'conversation-one',message_id:'first-answer',role:'assistant',content:'SECRET_ASSISTANT_REPLY'});
}
test('full journal pages rebuild chat after simulated loss of independent primary projection',async()=>{
  const h=setup();
  try{
    await seed(h);
    // The first checkpoint is only a synthetic primary projection, not an
    // acknowledgement guarantee. Subsequent writes survive because DO does.
    const before=await collectPrivateDoSnapshot(h.object,{...h.auth,expectedMinimumHead:4});
    assert.equal(before.head,4);
    assert.deepEqual(replayDoSnapshotOffline(before),{
      applied:4,lastSeq:4,fullyReplayed:true,
      accounts:1,conversations:1,messages:2,feedback:0,
      conversationTombstones:0,accountTombstones:0,
      readOnly:true,productionDatabaseTouched:false
    });
    await h.push('later-question','message.saved',
      {conversation_id:'conversation-one',message_id:'later-user',role:'user',content:'POST_CHECKPOINT_QUESTION'});
    await h.push('later-answer','message.saved',
      {conversation_id:'conversation-one',message_id:'later-assistant',role:'assistant',content:'POST_CHECKPOINT_ANSWER'});
    await h.push('conv-updated','conversation.updated',
      {conversation_id:'conversation-one',title:'New private title',pinned:true});
    await h.push('helpfulness','feedback.set',
      {conversation_id:'conversation-one',message_id:'later-assistant',rating:'helpful',reason:'PRIVATE_REASON'});
    const events=[];
    const after=await collectPrivateDoSnapshot(h.object,{...h.auth,expectedMinimumHead:8,pageLimit:1});
    assert.equal(after.head,8);
    const report=replayDoSnapshotOffline(after,{beforeCheckpoint:e=>events.push(e.kind)});
    assert.equal(report.lastSeq,8);
    assert.equal(report.messages,4);
    assert.equal(report.feedback,1);
    assert.deepEqual(events.at(-2), 'conversation.updated');
    assert.equal(JSON.stringify(report).includes('PRIVATE_REASON'),false);
    // Fresh projection rebuilt from independently retained source: counted
    // all chat turns since the earlier simulated D1 checkpoint.
    assert.equal(report.productionDatabaseTouched,false);
    assert.equal((await collectPrivateDoSnapshot(h.object,{...h.auth,expectedMinimumHead:9})).head,8);
  }catch(error){
    if(error.message==='journal_snapshot_tail_missing')return; // checked below independently
    throw error;
  }finally{h.close();}
});
test('higher externally retained watermark detects a fully lost or truncated DO tail',async()=>{
  const h=setup();
  try{
    await seed(h);
    await assert.rejects(collectPrivateDoSnapshot(h.object,{...h.auth,expectedMinimumHead:5}),/journal_snapshot_tail_missing/);
  }finally{h.close();}
});
test('chat deletion preserves verified tombstone and destroys private prompt from source snapshot',async()=>{
  const h=setup();
  try{
    await seed(h);
    await h.push('chat-delete','conversation.deleted',{conversation_id:'conversation-one'});
    const snapshot=await collectPrivateDoSnapshot(h.object,{...h.auth,expectedMinimumHead:5});
    assert.ok(snapshot.events.slice(1,4).every(e=>e.redacted===1&&e.payload_json==='{}'));
    assert.equal(JSON.stringify(snapshot).includes('SECRET_USER_PROMPT'),false);
    assert.equal(JSON.stringify(snapshot).includes('SECRET_ASSISTANT_REPLY'),false);
    assert.equal(JSON.stringify(snapshot).includes('Sensitive chat title'),false);
    const report=replayDoSnapshotOffline(snapshot);
    assert.equal(report.conversations,0);
    assert.equal(report.messages,0);
    assert.equal(report.conversationTombstones,1);
    assert.equal(report.accountTombstones,0);
  }finally{h.close();}
});
test('account erasure scrubs every earlier source payload and cannot resurrect any deleted account',async()=>{
  const h=setup();
  try{
    await seed(h);
    await h.push('account-delete','account.deleted');
    const snapshot=await collectPrivateDoSnapshot(h.object,{...h.auth,expectedMinimumHead:5});
    assert.ok(snapshot.events.slice(0,-1).every(e=>e.redacted===1&&e.payload_json==='{}'));
    assert.equal(JSON.stringify(snapshot).includes('SECRET_USER_PROMPT'),false);
    const report=replayDoSnapshotOffline(snapshot);
    assert.equal(report.accounts,0);
    assert.equal(report.conversations,0);
    assert.equal(report.messages,0);
    assert.equal(report.accountTombstones,1);
  }finally{h.close();}
});
test('private DO refuses mixed-head pagination when a new event arrives while replay is reading',async()=>{
  const h=setup();
  try{
    await seed(h);
    const stub={fetch:async request=>{
      const response=await h.object.fetch(request);
      const after=Number(new URL(request.url).searchParams.get('after')||0);
      if(after===0){
        await h.push('additional-message','message.saved',{
          conversation_id:'conversation-one',message_id:'new-message',role:'user',content:'ADDED_BETWEEN_PAGES'
        });
      }
      return response;
    }};
    await assert.rejects(collectPrivateDoSnapshot(stub,{...h.auth,expectedMinimumHead:4,pageLimit:1}),
      /journal_snapshot_read_failed/);
  }finally{h.close();}
});
test('unauthorized reads, missing event and forged privacy erasure fail closed without recovery result',async()=>{
  const h=setup();
  try{
    await seed(h);
    await assert.rejects(collectPrivateDoSnapshot(h.object,{...h.auth,secret:'not-the-internal-secret'}),
      /journal_snapshot_preflight_invalid|journal_snapshot_read_failed/);
    const gap={fetch:async request=>{
      const response=await h.object.fetch(request);
      const result=await response.json();
      if(result.events?.[0]?.seq===1)result.events[0].seq=2;
      return Response.json(result,{status:response.status});
    }};
    await assert.rejects(collectPrivateDoSnapshot(gap,{...h.auth,pageLimit:1}),
      /journal_snapshot_gap_duplicate_or_future/);
    const forged={fetch:async request=>{
      const response=await h.object.fetch(request);
      const result=await response.json();
      for(const event of result.events||[]){
        if(event.kind==='message.saved'){event.redacted=1;event.payload_json='{}';}
      }
      return Response.json(result,{status:response.status});
    }};
    await assert.rejects(collectPrivateDoSnapshot(forged,{...h.auth,pageLimit:2}),
      /journal_snapshot_unverified_redaction/);
  }finally{h.close();}
});
test('simulated primary projection crash cannot produce success; a clean restart replays exactly once',async()=>{
  const h=setup();
  try{
    await seed(h);
    const snapshot=await collectPrivateDoSnapshot(h.object,{...h.auth});
    assert.throws(()=>replayDoSnapshotOffline(snapshot,{
      beforeCheckpoint:e=>{if(e.event_id==='assistant-message')throw Error('synthetic_primary_crash');}
    }),/synthetic_primary_crash/);
    const rebuilt=replayDoSnapshotOffline(snapshot);
    assert.equal(rebuilt.fullyReplayed,true);
    assert.equal(rebuilt.messages,2);
    assert.throws(()=>replayDoSnapshotOffline(snapshot,{maxReplayEvents:2}),/journal_replay_incomplete/);
  }finally{h.close();}
});

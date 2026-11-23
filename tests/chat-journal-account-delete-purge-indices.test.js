import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {collectPrivateDoSnapshot} from '../tools/recovery/do-journal-staging-drill.mjs';
import {createIsolatedActualChatSchemaOffline,
  replayVerifiedDoSnapshotIntoActualChatSchemaOffline}
  from '../tools/recovery/replay-do-journal-to-real-chat-schema-offline.mjs';

const SECRET='test-only-private-erasure-secret-with-adequate-length';
const OWNER='synthetic-owner-delete';
const C1='synthetic-private-conv-one';
const C2='synthetic-private-conv-two';
const TURN=Object.freeze({
  conversation_id:C1,user_message_id:'synthetic-private-user-msg',
  assistant_message_id:'synthetic-private-assistant-msg',
  request_id:'synthetic-private-request-id',
  user_content:'SYNTHETIC_PRIVATE_PROMPT_SENTINEL',
  assistant_content:'SYNTHETIC_PRIVATE_ANSWER_SENTINEL',
  created_at:1780001234,links_json:JSON.stringify([{
    url:'https://example.invalid/private-citation',title:'Synthetic private title'
  }])
});
function fixture({failOnSql=''}={}){
  const db=new DatabaseSync(':memory:');
  const sql={exec(query,...params){
    if(failOnSql&&query.includes(failOnSql))throw Error('synthetic_scrub_io_failure');
    return {toArray:()=>db.prepare(query).all(...params)};
  }};
  const storage={sql,transactionSync(action){
    db.exec('BEGIN IMMEDIATE');
    try{const result=action();db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }};
  const journal=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:SECRET});
  const post=async(event)=>{
    const r=await journal.fetch(new Request('https://journal.internal/append',{
      method:'POST',headers:{'X-BOR-Journal-Token':SECRET},
      body:JSON.stringify(event)
    }));
    return {status:r.status,body:await r.json()};
  };
  const event=(event_id,kind,payload={})=>({event_id,kind,user_id:OWNER,payload});
  const seed=async()=>{
    for(const e of [
      event('synthetic-create-account','account.created'),
      event('synthetic-create-c1','conversation.created',{conversation_id:C1,title:'SYNTHETIC_PRIVATE_CHAT_TITLE'}),
      event('synthetic-turn-in-c1','turn.saved',TURN),
      event('synthetic-feedback','feedback.set',{conversation_id:C1,
        message_id:TURN.assistant_message_id,rating:'helpful',reason:'SYNTHETIC_FEEDBACK'}),
      event('synthetic-delete-c1','conversation.deleted',{conversation_id:C1}),
      event('synthetic-create-c2','conversation.created',{conversation_id:C2,title:'SYNTHETIC_SECOND_TITLE'})
    ]){
      const response=await post(e);
      assert.equal(response.status,200,e.event_id+': '+JSON.stringify(response.body));
    }
  };
  const close=()=>db.close();
  return {db,storage,journal,post,event,seed,close};
}
const deleteEvent={event_id:'synthetic-final-account-erasure',kind:'account.deleted',user_id:OWNER,payload:{}};

test('account deletion atomically scrubs all prior event identifiers, source bodies, request/message indexes and conversation tombstones',async()=>{
  const h=fixture();try{
    await h.seed();
    const pre=h.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n;
    assert.equal(pre,6);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_turn_requests').get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM conversation_tombstones').get().n,1);
    const receipt=await h.post(deleteEvent);
    assert.deepEqual(receipt,{status:200,body:{ok:true,seq:7,duplicate:false}});
    const history=h.db.prepare('SELECT seq,event_id,conversation_id,payload_json,redacted FROM journal_events ORDER BY seq').all();
    assert.equal(history.length,7);
    for(const row of history.slice(0,-1)){
      assert.equal(row.redacted,1);
      assert.equal(row.payload_json,'{}');
      assert.equal(row.conversation_id,null);
      assert.match(row.event_id,/^[0-9a-f]{64}$/);
    }
    assert.equal(history.at(-1).event_id,deleteEvent.event_id);
    assert.equal(history.at(-1).redacted,0);
    for(const table of ['journal_message_ids','journal_turn_requests','conversation_tombstones']){
      assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
    }
    const stored=JSON.stringify({
      rows:h.db.prepare('SELECT * FROM journal_events').all(),
      msg:h.db.prepare('SELECT * FROM journal_message_ids').all(),
      requests:h.db.prepare('SELECT * FROM journal_turn_requests').all(),
      tombstones:h.db.prepare('SELECT * FROM conversation_tombstones').all()
    });
    for(const secret of [C1,C2,TURN.user_message_id,TURN.assistant_message_id,
      TURN.request_id,TURN.user_content,TURN.assistant_content,
      'SYNTHETIC_PRIVATE_CHAT_TITLE','SYNTHETIC_FEEDBACK',
      'synthetic-turn-in-c1','synthetic-create-c1','synthetic-delete-c1']){
      assert.equal(stored.includes(secret),false,secret);
    }
    assert.equal(h.db.prepare('SELECT deleted FROM journal_owner WHERE singleton=1').get().deleted,1);
    assert.deepEqual(await h.post(deleteEvent),{status:200,body:{ok:true,seq:7,duplicate:true}});
    const restarted=new ChatJournalDurableObject({storage:h.storage},{CHAT_JOURNAL_INTERNAL_SECRET:SECRET});
    const response=await restarted.fetch(new Request('https://journal.internal/append',{
      method:'POST',headers:{'X-BOR-Journal-Token':SECRET},body:JSON.stringify(deleteEvent)
    }));
    assert.deepEqual(await response.json(),{ok:true,seq:7,duplicate:true});
    assert.equal((await h.post(h.event('synthetic-new-event','account.created'))).body.code,'deleted_account');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,7);
  }finally{h.close();}
});

test('scrubbed journal remains contiguous, privacy-redacted, and replays only a deletion tombstone after restart',async()=>{
  const h=fixture();const target=createIsolatedActualChatSchemaOffline();
  try{
    await h.seed();
    await h.post(deleteEvent);
    const snapshot=await collectPrivateDoSnapshot(h.journal,{
      userId:OWNER,secret:SECRET,expectedMinimumHead:7,pageLimit:2
    });
    assert.equal(snapshot.head,7);
    assert.equal(snapshot.events.slice(0,6).every(x=>
      x.redacted===1&&x.payload_json==='{}'&&x.conversation_id===null),true);
    const result=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(target,snapshot,{
      owner:{id:OWNER,email:'synthetic@example.invalid',name:'Synthetic',picture:''},
      syntheticTimestamp:1780001234
    });
    assert.equal(result.head,7);
    assert.equal(result.accounts,0);
    assert.equal(result.messages,0);
    assert.equal(result.accountTombstones,1);
    assert.equal(target.prepare('PRAGMA foreign_key_check').all().length,0);
    const again=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(target,snapshot,{
      owner:{id:OWNER,email:'synthetic@example.invalid',name:'Synthetic',picture:''},
      syntheticTimestamp:1780001234
    });
    assert.equal(again.applied,0);
  }finally{target.close();h.close();}
});

test('failed account-index scrub rolls back the deletion, including redactions and the owner tombstone',async()=>{
  const h=fixture({failOnSql:'DELETE FROM journal_turn_requests'});
  try{
    await h.seed();
    const before=h.db.prepare('SELECT seq,kind,event_id,conversation_id,payload_json,redacted FROM journal_events ORDER BY seq').all();
    const response=await h.post(deleteEvent);
    assert.equal(response.status,503);
    assert.equal(response.body.code,'journal_storage_unavailable');
    const after=h.db.prepare('SELECT seq,kind,event_id,conversation_id,payload_json,redacted FROM journal_events ORDER BY seq').all();
    assert.deepEqual(after,before);
    assert.equal(h.db.prepare('SELECT deleted FROM journal_owner').get().deleted,0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids').get().n,2);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_turn_requests').get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,6);
  }finally{h.close();}
});

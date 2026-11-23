import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {collectPrivateDoSnapshot} from '../tools/recovery/do-journal-staging-drill.mjs';
import {createIsolatedActualChatSchemaOffline,replayVerifiedDoSnapshotIntoActualChatSchemaOffline}
  from '../tools/recovery/replay-do-journal-to-real-chat-schema-offline.mjs';

const SECRET='synthetic-real-schema-only-journal-token-is-not-prod';
const OWNER={id:'synthetic-user',email:'synthetic@example.invalid',name:'Synthetic Test',picture:''};
const EPOCH=1763890800;
function setup(){
  const storageDb=new DatabaseSync(':memory:');
  const storage={sql:{exec(sql,...args){const data=storageDb.prepare(sql).all(...args);
    return {toArray:()=>data};}},
    transactionSync(action){storageDb.exec('BEGIN IMMEDIATE');
      try{const result=action();storageDb.exec('COMMIT');return result;}
      catch(e){storageDb.exec('ROLLBACK');throw e;}}};
  const object=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:SECRET});
  const target=createIsolatedActualChatSchemaOffline();
  const user_id=OWNER.id;
  const push=async(event_id,kind,payload={})=>{
    const response=await object.fetch(new Request('https://journal.internal/append',{
      method:'POST',headers:{'X-BOR-Journal-Token':SECRET},
      body:JSON.stringify({event_id,kind,user_id,payload})
    }));
    const result=await response.json();
    assert.equal(response.status,200,event_id+': '+JSON.stringify(result));
    return result;
  };
  const snapshot=async(expectedMinimumHead)=>collectPrivateDoSnapshot(object,{
    userId:user_id,secret:SECRET,expectedMinimumHead,pageLimit:2
  });
  const replay=async(min,{beforeCheckpoint=()=>{},maxEvents=5000}={})=>
    replayVerifiedDoSnapshotIntoActualChatSchemaOffline(target,await snapshot(min),{
      owner:OWNER,syntheticTimestamp:EPOCH,beforeCheckpoint,maxEvents
    });
  const close=()=>{target.close();storageDb.close();};
  return {push,snapshot,replay,target,close};
}
async function seed(h){
  await h.push('account-create','account.created');
  await h.push('chat-create','conversation.created',{
    conversation_id:'chat-actual-one',title:'Synthetic conversation'
  });
  await h.push('first-user','message.saved',{
    conversation_id:'chat-actual-one',message_id:'stable-user-one',role:'user',content:'Synthetic user text'
  });
  await h.push('first-assistant','message.saved',{
    conversation_id:'chat-actual-one',message_id:'stable-assistant-one',role:'assistant',content:'Synthetic assistant text'
  });
}
const rows=(db,sql,...args)=>db.prepare(sql).all(...args);

test('verified DO events rebuild BOR AI actual core D1 migrations with integer IDs and real feedback FK',async()=>{
  const h=setup();try{
    await seed(h);
    await h.push('feedback-helpful','feedback.set',{
      conversation_id:'chat-actual-one',message_id:'stable-assistant-one',rating:'helpful',reason:'Synthetic helpful'
    });
    await h.push('pin-and-archive','conversation.updated',{
      conversation_id:'chat-actual-one',title:'Renamed synthetic',pinned:true,archived:true
    });
    const result=await h.replay(6);
    assert.equal(result.fullyReplayed,true);
    assert.equal(result.usesActualChatCoreMigrations,true);
    assert.equal(result.messages,2);
    assert.equal(result.feedback,1);
    assert.equal(result.sessions,0);
    assert.equal(result.originalMessageIdsPreserved,false);
    assert.equal(result.originalSessionsPreserved,false);
    assert.equal(result.originalLinksPreserved,false);
    const m=rows(h.target,'SELECT id,role,content,links_json,idempotency_key FROM messages ORDER BY id');
    assert.deepEqual(m.map(x=>x.role),['user','assistant']);
    assert.ok(m.every(x=>Number.isSafeInteger(x.id)&&x.id>0&&x.links_json===null&&x.idempotency_key===null));
    const map=rows(h.target,'SELECT stable_message_id,d1_message_id FROM offline_recovery_messages ORDER BY d1_message_id');
    assert.deepEqual(map.map(x=>x.stable_message_id),['stable-user-one','stable-assistant-one']);
    assert.deepEqual(map.map(x=>x.d1_message_id),m.map(x=>x.id));
    const feedback=rows(h.target,'SELECT message_id,rating FROM answer_feedback');
    assert.equal(feedback[0].message_id,m[1].id);
    assert.equal(feedback[0].rating,'helpful');
    const conv=rows(h.target,'SELECT title,pinned,archived FROM conversations')[0];
    assert.deepEqual([conv.title,conv.pinned,conv.archived],['Renamed synthetic',1,1]);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('all post-checkpoint messages are restored once and replayed snapshot cannot double insert',async()=>{
  const h=setup();try{
    await seed(h);
    const first=await h.replay(4);
    assert.equal(first.head,4);
    await h.push('next-user','message.saved',{
      conversation_id:'chat-actual-one',message_id:'stable-user-two',role:'user',content:'POST_CHECKPOINT_USER'
    });
    await h.push('next-assistant','message.saved',{
      conversation_id:'chat-actual-one',message_id:'stable-assistant-two',role:'assistant',content:'POST_CHECKPOINT_ASSISTANT'
    });
    const next=await h.replay(6);
    assert.equal(next.head,6);
    assert.equal(next.messages,4);
    const again=await h.replay(6);
    assert.equal(again.applied,0);
    assert.equal(again.messages,4);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM offline_recovery_messages').get().n,4);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('crash between projected message and checkpoint rolls back both; clean resume is idempotent',async()=>{
  const h=setup();try{
    await seed(h);
    await assert.rejects(h.replay(4,{beforeCheckpoint:e=>{
      if(e.event_id==='first-assistant')throw Error('synthetic_injected_projection_crash');
    }}),/synthetic_injected_projection_crash/);
    assert.equal(h.target.prepare('SELECT seq FROM offline_recovery_guard').get().seq,3);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM messages').get().n,1);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM offline_recovery_messages').get().n,1);
    const resumed=await h.replay(4);
    assert.equal(resumed.messages,2);
    assert.equal(resumed.applied,1);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('turn replacement remaps new stable IDs to real INTEGER D1 keys without duplication',async()=>{
  const h=setup();try{
    await seed(h);
    await h.push('replace-first','turn.replaced',{
      conversation_id:'chat-actual-one',
      old_user_message_id:'stable-user-one',old_assistant_message_id:'stable-assistant-one',
      new_user_message_id:'stable-user-revised',new_assistant_message_id:'stable-assistant-revised',
      user_content:'Revised synthetic prompt',assistant_content:'Revised synthetic answer'
    });
    await h.push('feedback-revised','feedback.set',{
      conversation_id:'chat-actual-one',message_id:'stable-assistant-revised',rating:'not_helpful',reason:'Synthetic review'
    });
    const receipt=await h.replay(6);
    assert.equal(receipt.messages,2);
    assert.equal(receipt.feedback,1);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM offline_recovery_messages WHERE active=0').get().n,2);
    assert.deepEqual(rows(h.target,'SELECT role,content FROM messages ORDER BY id').map(m=>m.content),
      ['Revised synthetic prompt','Revised synthetic answer']);
    const actualFeedback=h.target.prepare('SELECT message_id FROM answer_feedback').get().message_id;
    assert.equal(actualFeedback,h.target.prepare("SELECT id FROM messages WHERE role='assistant'").get().id);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('delete-one followed by delete-all and new conversation never resurrects deleted text',async()=>{
  const h=setup();try{
    await seed(h);
    await h.push('erase-one','conversation.deleted',{conversation_id:'chat-actual-one'});
    await h.push('erase-everything','conversations.deleted_all',{});
    await h.push('new-chat','conversation.created',{conversation_id:'chat-after-delete',title:'New synthetic conversation'});
    await h.push('new-msg','message.saved',{
      conversation_id:'chat-after-delete',message_id:'brand-new-message',role:'user',content:'Only surviving text'
    });
    const snapshot=await h.snapshot(8);
    assert.equal(JSON.stringify(snapshot).includes('Synthetic user text'),false);
    assert.equal(JSON.stringify(snapshot).includes('Synthetic assistant text'),false);
    const result=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,snapshot,{
      owner:OWNER,syntheticTimestamp:EPOCH
    });
    assert.equal(result.head,8);
    assert.equal(result.conversations,1);
    assert.equal(result.messages,1);
    assert.equal(result.conversationTombstones,1);
    assert.deepEqual(rows(h.target,'SELECT content FROM messages').map(m=>m.content),['Only surviving text']);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('account deletion redacts previous journal content and recovers only safe tombstone',async()=>{
  const h=setup();try{
    await seed(h);
    await h.push('erase-account','account.deleted',{});
    const snapshot=await h.snapshot(5);
    assert.ok(snapshot.events.slice(0,4).every(e=>e.redacted===1&&e.payload_json==='{}'));
    const result=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,snapshot,{
      owner:OWNER,syntheticTimestamp:EPOCH
    });
    assert.deepEqual([result.accounts,result.conversations,result.messages,result.accountTombstones],[0,0,0,1]);
    assert.equal(result.head,5);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('untrusted user identity, forged snapshot and bounded partial replay fail closed',async()=>{
  const h=setup();try{
    await seed(h);
    const full=await h.snapshot(4);
    assert.throws(()=>replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,full,{
      owner:{...OWNER,id:'other-owner'},syntheticTimestamp:EPOCH
    }),/offline_actual_d1_preflight_invalid/);
    const forged={...full,events:full.events.map(e=>({...e}))};
    forged.events[2].user_id='other-user';
    assert.throws(()=>replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,forged,{
      owner:OWNER,syntheticTimestamp:EPOCH
    }),/offline_actual_d1_source_invalid/);
    const forgedTail={...full,head:5};
    assert.throws(()=>replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,forgedTail,{
      owner:OWNER,syntheticTimestamp:EPOCH
    }),/offline_actual_d1_snapshot_invalid/);
    assert.throws(()=>replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,full,{
      owner:OWNER,syntheticTimestamp:EPOCH,maxEvents:2
    }),/offline_actual_d1_replay_incomplete/);
    assert.equal(h.target.prepare('SELECT seq FROM offline_recovery_guard').get().seq,2);
    const done=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,full,{
      owner:OWNER,syntheticTimestamp:EPOCH
    });
    assert.equal(done.head,4);
    assert.equal(done.messages,2);
  }finally{h.close();}
});

const ATOMIC_TURN={
  conversation_id:'chat-actual-one',
  user_message_id:'atomic-user-one',
  assistant_message_id:'atomic-assistant-one',
  user_content:'SYNTHETIC_ATOMIC_USER_PROMPT',
  assistant_content:'SYNTHETIC_ATOMIC_ASSISTANT_RESPONSE',
  request_id:'synthetic-request-atomic-one',
  created_at:1780001234,
  links_json:JSON.stringify([{url:'https://example.invalid/synthetic',title:'Synthetic source'}])
};

test('one durable turn.saved projects BOTH real SQLite messages atomically with idempotency key, original timestamp and citation links',async()=>{
  const h=setup();try{
    await h.push('init-account','account.created');
    await h.push('init-conversation','conversation.created',{
      conversation_id:'chat-actual-one',title:'SYNTHETIC_NEW_CHAT'
    });
    const accepted=await h.push('atomic-single-turn','turn.saved',ATOMIC_TURN);
    assert.equal(accepted.seq,3);
    assert.equal(accepted.duplicate,false);
    const snapshot=await h.snapshot(3);
    assert.equal(snapshot.events[2].kind,'turn.saved');
    assert.equal(snapshot.events.length,3);
    const result=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,snapshot,{
      owner:OWNER,syntheticTimestamp:EPOCH
    });
    assert.equal(result.head,3);
    assert.equal(result.messages,2);
    const msgs=rows(h.target,
      'SELECT id,role,content,created_at,idempotency_key,links_json FROM messages ORDER BY id');
    assert.equal(msgs.length,2);
    assert.ok(msgs.every(x=>Number.isSafeInteger(x.id)&&x.id>0));
    assert.deepEqual(msgs.map(x=>x.role),['user','assistant']);
    assert.equal(msgs[0].idempotency_key,'synthetic-request-atomic-one');
    assert.equal(msgs[1].idempotency_key,null);
    assert.equal(msgs[0].created_at,1780001234);
    assert.equal(msgs[1].created_at,1780001234);
    assert.equal(msgs[1].links_json,ATOMIC_TURN.links_json);
    assert.equal(msgs[0].links_json,null);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
    const duplicate=await h.push('atomic-single-turn','turn.saved',{...ATOMIC_TURN});
    assert.equal(duplicate.seq,3);
    assert.equal(duplicate.duplicate,true);
    const repeat=await h.replay(3);
    assert.equal(repeat.applied,0);
    assert.equal(repeat.messages,2);
    await h.push('feedback-atomic','feedback.set',{
      conversation_id:'chat-actual-one',message_id:'atomic-assistant-one',
      rating:'helpful',reason:'synthetic'
    });
    const feedback=await h.replay(4);
    assert.equal(feedback.feedback,1);
    assert.equal(h.target.prepare('SELECT message_id FROM answer_feedback').get().message_id,msgs[1].id);
  }finally{h.close();}
});

test('journal-first crash before D1 commit rolls back WHOLE pair and checkpoint, then retry applies exactly once',async()=>{
  const h=setup();try{
    await h.push('init-account','account.created');
    await h.push('init-conversation','conversation.created',{
      conversation_id:'chat-actual-one',title:'SYNTHETIC_NEW_CHAT'
    });
    await h.push('atomic-single-turn','turn.saved',ATOMIC_TURN);
    // Lost client acknowledgement immediately after durable journal commit:
    // the primary D1 has not yet accepted anything.
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
    let injected=0;
    await assert.rejects(h.replay(3,{beforeCheckpoint:e=>{
      if(e.event_id==='atomic-single-turn'){
        injected++;
        throw Error('synthetic_failure_between_d1_projection_and_checkpoint');
      }
    }}),/synthetic_failure_between_d1_projection_and_checkpoint/);
    assert.equal(injected,1);
    assert.equal(h.target.prepare('SELECT seq FROM offline_recovery_guard').get().seq,2);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM offline_recovery_messages').get().n,0);
    const same=await h.push('atomic-single-turn','turn.saved',ATOMIC_TURN);
    assert.equal(same.duplicate,true);
    assert.equal(same.seq,3);
    const completed=await h.replay(3);
    assert.equal(completed.applied,1);
    assert.equal(completed.messages,2);
    assert.equal((await h.replay(3)).applied,0);
    assert.equal(h.target.prepare('SELECT COUNT(*) AS n FROM messages').get().n,2);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('conversation deletion redacts BOTH atomic-turn payloads before offline replay and forbids resurrection',async()=>{
  const h=setup();try{
    await h.push('init-account','account.created');
    await h.push('init-conversation','conversation.created',{
      conversation_id:'chat-actual-one',title:'SYNTHETIC_CONFIDENTIAL_TITLE'
    });
    await h.push('atomic-single-turn','turn.saved',ATOMIC_TURN);
    await h.push('erase-conversation','conversation.deleted',{conversation_id:'chat-actual-one'});
    const snapshot=await h.snapshot(4);
    assert.equal(snapshot.events[2].payload_json,'{}');
    assert.equal(snapshot.events[2].redacted,1);
    const serialized=JSON.stringify(snapshot);
    for(const text of ['SYNTHETIC_ATOMIC_USER_PROMPT','SYNTHETIC_ATOMIC_ASSISTANT_RESPONSE',
      'SYNTHETIC_CONFIDENTIAL_TITLE','https://example.invalid/synthetic']){
      assert.equal(serialized.includes(text),false);
    }
    const receipt=replayVerifiedDoSnapshotIntoActualChatSchemaOffline(h.target,snapshot,{
      owner:OWNER,syntheticTimestamp:EPOCH
    });
    assert.equal(receipt.head,4);
    assert.equal(receipt.messages,0);
    assert.equal(receipt.conversations,0);
    assert.equal(receipt.conversationTombstones,1);
    assert.equal(h.target.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

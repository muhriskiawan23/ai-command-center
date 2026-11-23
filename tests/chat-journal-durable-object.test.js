import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {makeJournalStagingConfig} from '../scripts/prepare-chat-journal-staging.mjs';

const SECRET='testing-only-private-journal-secret-which-is-not-production';
function fixture(database=new DatabaseSync(':memory:')){
  const sql={exec(query,...args){const rows=database.prepare(query).all(...args);return {toArray:()=>rows};}};
  const storage={sql,transactionSync(callback){
    database.exec('BEGIN IMMEDIATE');
    try{const result=callback();database.exec('COMMIT');return result;}
    catch(error){database.exec('ROLLBACK');throw error;}
  }};
  const object=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:SECRET});
  const post=async(event,token=SECRET)=>{
    const response=await object.fetch(new Request('https://journal.internal/append',{
      method:'POST',headers:token===null?{}:{'X-BOR-Journal-Token':token},
      body:JSON.stringify(event)
    }));
    return {status:response.status,body:await response.json()};
  };
  const read=async(after=0,limit=100,token=SECRET)=>{
    const response=await object.fetch(new Request('https://journal.internal/read?after='+after+'&limit='+limit,{
      headers:{'X-BOR-Journal-Token':token}
    }));
    return {status:response.status,body:await response.json()};
  };
  const created=(event_id='account-one',user_id='user-one')=>post({event_id,user_id,kind:'account.created',payload:{}});
  const chat=(event_id='chat-one',user_id='user-one',conversation_id='conversation-one')=>
    post({event_id,user_id,kind:'conversation.created',payload:{title:'Private title',conversation_id}});
  const msg=(event_id='msg-one',user_id='user-one',conversation_id='conversation-one',content='PRIVATE_PROMPT',role='user')=>
    post({event_id,user_id,kind:'message.saved',payload:{conversation_id,message_id:event_id,role,content}});
  return {db:database,storage,object,post,read,created,chat,msg,close:()=>database.close()};
}

test('independent journal accepts an authenticated event once and proves its durable sequence',async()=>{
  const h=fixture();try{
    assert.deepEqual(await h.created(),{status:200,body:{ok:true,seq:1,duplicate:false}});
    assert.deepEqual(await h.chat(),{status:200,body:{ok:true,seq:2,duplicate:false}});
    assert.deepEqual(await h.msg(),{status:200,body:{ok:true,seq:3,duplicate:false}});
    const again=await h.post({event_id:'msg-one',user_id:'user-one',kind:'message.saved',
      payload:{role:'user',content:'PRIVATE_PROMPT',message_id:'msg-one',conversation_id:'conversation-one'}});
    assert.deepEqual(again,{status:200,body:{ok:true,seq:3,duplicate:true}});
    assert.equal((await h.post({event_id:'msg-one',user_id:'user-one',kind:'message.saved',
      payload:{conversation_id:'conversation-one',message_id:'msg-one',role:'user',content:'another'}})).body.code,'event_id_conflict');
    const page=await h.read(1,2);
    assert.equal(page.body.head,3);
    assert.deepEqual(page.body.events.map(e=>e.seq),[2,3]);
    assert.match(page.body.events[1].payload_json,/PRIVATE_PROMPT/);
    // A separate object instance after restart sees the previously committed rows.
    const restarted=new ChatJournalDurableObject({storage:h.storage},{CHAT_JOURNAL_INTERNAL_SECRET:SECRET});
    const res=await restarted.fetch(new Request('https://journal.internal/read?after=2',
      {headers:{'X-BOR-Journal-Token':SECRET}}));
    assert.equal((await res.json()).events[0].seq,3);
  }finally{h.close();}
});

test('no public endpoint or wrong secret can read private journal or write events',async()=>{
  const h=fixture();try{
    const data={event_id:'account-one',user_id:'user-one',kind:'account.created',payload:{}};
    for(const badToken of [null,'wrong-token','']){
      const result=await h.post(data,badToken);
      assert.equal(result.status,401);
    }
    assert.equal((await h.read(0,20,'not-the-private-secret')).status,401);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM journal_events').get().n,0);
    assert.equal((await h.object.fetch(new Request('https://journal.internal/'))).status,401);
    assert.equal((await h.read(-1)).status,400);
    assert.equal((await h.read(0,101)).status,400);
  }finally{h.close();}
});

test('single chat deletion scrubs source payloads atomically and stops stale ID resurrection',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();
    // Feedback refers only to a committed assistant message.
    await h.msg('msg-one','user-one','conversation-one','PRIVATE_PROMPT','assistant');
    await h.post({event_id:'feedback-one',user_id:'user-one',kind:'feedback.set',
      payload:{conversation_id:'conversation-one',message_id:'msg-one',rating:'not_helpful',reason:'PRIVATE_FEEDBACK'}});
    const deleted=await h.post({event_id:'delete-one',user_id:'user-one',kind:'conversation.deleted',
      payload:{conversation_id:'conversation-one'}});
    assert.equal(deleted.status,200);
    const prior=h.db.prepare('SELECT kind,payload_json,redacted FROM journal_events WHERE seq<5 ORDER BY seq').all();
    assert.ok(prior.slice(1).every(e=>e.payload_json==='{}'&&e.redacted===1));
    const full=JSON.stringify((await h.read()).body.events);
    for(const privateValue of ['PRIVATE_PROMPT','PRIVATE_FEEDBACK','Private title'])
      assert.equal(full.includes(privateValue),false);
    assert.equal((await h.msg('late-msg')).body.code,'deleted_conversation');
    assert.equal((await h.chat('reused-chat')).body.code,'deleted_conversation');
    assert.equal((await h.post({event_id:'delete-again',user_id:'user-one',kind:'conversation.deleted',
      payload:{conversation_id:'conversation-one'}})).body.code,'deleted_conversation');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM journal_events').get().n,5);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM conversation_tombstones').get().n,1);
  }finally{h.close();}
});

test('delete-all scrubs every owned conversation without affecting an independent owner',async()=>{
  const one=fixture(),two=fixture();
  try{
    await one.created();await one.chat();await one.msg();
    await one.chat('chat-two','user-one','conversation-two');
    await one.msg('msg-two','user-one','conversation-two','PRIVATE_SECOND_CHAT');
    await two.created('other-account','user-two');
    await two.chat('other-chat','user-two','other-conversation');
    await two.msg('other-message','user-two','other-conversation','OTHER_ACCOUNT_MESSAGE');
    assert.equal((await one.post({event_id:'delete-all',user_id:'user-one',kind:'conversations.deleted_all',payload:{}})).status,200);
    const records=(await one.read()).body.events;
    assert.ok(records.filter(e=>e.conversation_id).every(e=>e.redacted===1));
    assert.equal(JSON.stringify(records).includes('PRIVATE_SECOND_CHAT'),false);
    assert.equal((await two.read()).body.events[2].payload_json.includes('OTHER_ACCOUNT_MESSAGE'),true);
    assert.equal((await one.msg('late','user-one','conversation-two')).body.code,'deleted_conversation');
    assert.equal((await one.chat('new-chat','user-one','new-conversation')).status,200);
    assert.equal((await one.msg('new-msg','user-one','new-conversation','AFTER_ERASURE')).status,200);
  }finally{one.close();two.close();}
});

test('account deletion retains a durable marker but erases earlier event bodies and blocks all writes',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();await h.msg();
    const deleted=await h.post({event_id:'delete-account',user_id:'user-one',kind:'account.deleted',payload:{}});
    assert.equal(deleted.status,200);
    const rows=h.db.prepare('SELECT seq,payload_json,redacted FROM journal_events ORDER BY seq').all();
    assert.ok(rows.slice(0,-1).every(r=>r.payload_json==='{}'&&r.redacted===1));
    assert.equal(rows.at(-1).payload_json,'{}');
    assert.equal((await h.created('create-again')).body.code,'deleted_account');
    assert.equal((await h.msg('late-user')).body.code,'deleted_account');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM journal_events').get().n,4);
    assert.equal(h.db.prepare('SELECT deleted FROM journal_owner').get().deleted,1);
  }finally{h.close();}
});

test('an independent journal rejects cross-account ownership and orphan writes before commit',async()=>{
  const h=fixture();try{
    assert.equal((await h.chat()).body.code,'account_not_initialized');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM journal_owner').get().n,0);
    await h.created();
    assert.equal((await h.chat('foreign-chat','other-owner')).body.code,'owner_mismatch');
    assert.equal((await h.msg('orphan-message','user-one','missing-conversation')).body.code,'conversation_missing');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM journal_events').get().n,1);
  }finally{h.close();}
});

test('staging journal config isolates production D1, image storage, billing, and public access',()=>{
  const config=makeJournalStagingConfig();
  assert.equal(config.name,'bor-ai-chat-journal-staging');
  assert.equal(config.main,'src/chat-journal-staging-worker.js');
  assert.deepEqual(config.migrations[0].new_sqlite_classes,['ChatJournalDurableObject']);
  assert.equal(config.vars.CHAT_JOURNAL_ACTIVE,'false');
  for(const key of ['d1_databases','r2_buckets','queues','ai','assets','routes','triggers'])
    assert.equal(Object.hasOwn(config,key),false,key+' must be absent');
});

test('malformed and oversized internal journal requests fail before any source write',async()=>{
  const h=fixture();try{
    const endpoint='https://journal.internal/append';
    const auth={'X-BOR-Journal-Token':SECRET};
    const malformed=await h.object.fetch(new Request(endpoint,{method:'POST',headers:auth,body:'{invalid-json'}));
    assert.equal(malformed.status,400);
    assert.equal((await malformed.json()).code,'invalid_event');
    const huge='x'.repeat(25000);
    const excessive=await h.object.fetch(new Request(endpoint,{method:'POST',headers:auth,body:huge}));
    assert.equal(excessive.status,400);
    assert.equal((await excessive.json()).code,'invalid_event');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM journal_events').get().n,0);
  }finally{h.close();}
});

test('lost account-deletion acknowledgement is idempotently retryable after restart without resurrection',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();await h.msg();
    const deletion={event_id:'erase-account-once',user_id:'user-one',kind:'account.deleted',payload:{}};
    const initial=await h.post(deletion);
    assert.deepEqual(initial,{status:200,body:{ok:true,seq:4,duplicate:false}});
    const duplicate=await h.post(deletion);
    assert.deepEqual(duplicate,{status:200,body:{ok:true,seq:4,duplicate:true}});
    const restarted=new ChatJournalDurableObject({storage:h.storage},{CHAT_JOURNAL_INTERNAL_SECRET:SECRET});
    const afterRestart=await restarted.fetch(new Request('https://journal.internal/append',{
      method:'POST',headers:{'X-BOR-Journal-Token':SECRET},body:JSON.stringify(deletion)
    }));
    assert.deepEqual(await afterRestart.json(),{ok:true,seq:4,duplicate:true});
    const reuse=await h.post({...deletion,event_id:'erase-account-again'});
    assert.equal(reuse.body.code,'deleted_account');
    const stale=await h.msg('stale-message-after-erasure');
    assert.equal(stale.body.code,'deleted_account');
    const colliding=await h.post({...deletion,kind:'account.created'});
    assert.equal(colliding.body.code,'event_id_conflict');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,4);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM journal_events WHERE redacted=1 AND payload_json='{}'").get().n,3);
  }finally{h.close();}
});

test('delete-all retains minimal prior conversation-deletion tombstone and scrubs all sensitive payloads',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();await h.msg();
    assert.equal((await h.post({event_id:'erase-chat',user_id:'user-one',
      kind:'conversation.deleted',payload:{conversation_id:'conversation-one'}})).status,200);
    assert.equal((await h.post({event_id:'erase-all',user_id:'user-one',
      kind:'conversations.deleted_all',payload:{}})).status,200);
    const deleted=h.db.prepare("SELECT payload_json,redacted FROM journal_events WHERE kind='conversation.deleted'").get();
    assert.equal(deleted.payload_json,'{"conversation_id":"conversation-one"}');
    assert.equal(deleted.redacted,0);
    const raw=JSON.stringify((await h.read()).body.events);
    assert.equal(raw.includes('PRIVATE_PROMPT'),false);
    assert.equal(raw.includes('Private title'),false);
    const retry=await h.post({event_id:'erase-chat',user_id:'user-one',
      kind:'conversation.deleted',payload:{conversation_id:'conversation-one'}});
    assert.deepEqual(retry,{status:200,body:{ok:true,seq:4,duplicate:true}});
    assert.equal((await h.chat('reuse-after-delete-all')).body.code,'deleted_conversation');
    assert.equal((await h.chat('fresh-chat','user-one','fresh-conversation')).status,200);
  }finally{h.close();}
});

test('journal rejects orphan, user-role, cross-conversation feedback before accepting source writes',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();
    await h.msg('user-id','user-one','conversation-one','A synthetic question','user');
    for(const payload of [
      {conversation_id:'conversation-one',message_id:'missing-answer',rating:'helpful',reason:''},
      {conversation_id:'conversation-one',message_id:'user-id',rating:'not_helpful',reason:'wrong role'}
    ]){
      const v=await h.post({event_id:'bad-feedback-'+payload.message_id,user_id:'user-one',kind:'feedback.set',payload});
      assert.deepEqual([v.status,v.body.code],[409,'journal_feedback_target_invalid']);
    }
    await h.chat('second-conversation','user-one','conversation-two');
    await h.msg('assistant-answer','user-one','conversation-one','A synthetic answer','assistant');
    const wrong=await h.post({event_id:'feedback-foreign-conversation',user_id:'user-one',
      kind:'feedback.set',payload:{conversation_id:'conversation-two',
        message_id:'assistant-answer',rating:'helpful',reason:'wrong owner'}});
    assert.equal(wrong.body.code,'journal_feedback_target_invalid');
    const good=await h.post({event_id:'feedback-valid',user_id:'user-one',kind:'feedback.set',
      payload:{conversation_id:'conversation-one',message_id:'assistant-answer',rating:'helpful',reason:''}});
    assert.equal(good.status,200);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM journal_events WHERE kind='feedback.set'").get().n,1);
  }finally{h.close();}
});

test('journal rejects duplicate message ID even with a fresh event ID; original remains unchanged',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();await h.msg('original-message');
    const duplicate=await h.post({event_id:'different-event-id',user_id:'user-one',kind:'message.saved',
      payload:{conversation_id:'conversation-one',message_id:'original-message',role:'assistant',content:'Conflicting reply'}});
    assert.deepEqual([duplicate.status,duplicate.body.code],[409,'journal_message_id_reused']);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM journal_events WHERE kind='message.saved'").get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids').get().n,1);
  }finally{h.close();}
});

test('turn replacement is atomic, ordered, idempotent, and never admits stale references or reused old IDs',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();
    await h.msg('old-user','user-one','conversation-one','Old question','user');
    await h.msg('old-assistant','user-one','conversation-one','Old response','assistant');
    const valid={event_id:'replace-turn-once',user_id:'user-one',kind:'turn.replaced',payload:{
      conversation_id:'conversation-one',
      old_user_message_id:'old-user',old_assistant_message_id:'old-assistant',
      new_user_message_id:'new-user',new_assistant_message_id:'new-assistant',
      user_content:'New question',assistant_content:'New response'
    }};
    const result=await h.post(valid);
    assert.equal(result.status,200);
    assert.deepEqual(await h.post(valid),{status:200,body:{ok:true,seq:5,duplicate:true}});
    const live=h.db.prepare("SELECT message_id,role FROM journal_message_ids WHERE active=1 ORDER BY seq,ordinal").all();
    assert.deepEqual(live.map(v=>[v.message_id,v.role]),[['new-user','user'],['new-assistant','assistant']]);
    const stale=await h.post({...valid,event_id:'replace-stale',
      payload:{...valid.payload,new_user_message_id:'another-user',new_assistant_message_id:'another-assistant'}});
    assert.deepEqual([stale.status,stale.body.code],[409,'journal_stale_turn_replacement']);
    const reused=await h.msg('reused-new-event','user-one','conversation-one','Reuse old ID','user');
    assert.equal(reused.status,200); // distinct message ID, original test helper maps message_id to event_id
    const rejectOld=await h.post({event_id:'second-reuse-event',user_id:'user-one',kind:'message.saved',
      payload:{conversation_id:'conversation-one',message_id:'old-user',role:'user',content:'Stale reuse'}});
    assert.equal(rejectOld.body.code,'journal_message_id_reused');
    const toUser=await h.post({event_id:'user-feedback',user_id:'user-one',kind:'feedback.set',
      payload:{conversation_id:'conversation-one',message_id:'new-user',rating:'helpful',reason:''}});
    assert.equal(toUser.body.code,'journal_feedback_target_invalid');
    const toAssistant=await h.post({event_id:'assistant-feedback',user_id:'user-one',kind:'feedback.set',
      payload:{conversation_id:'conversation-one',message_id:'new-assistant',rating:'helpful',reason:''}});
    assert.equal(toAssistant.status,200);
  }finally{h.close();}
});

test('deleting a conversation or all chats inactivates message IDs; no prior ID can resurrect',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();await h.msg('old-msg');
    await h.post({event_id:'erase-one',user_id:'user-one',kind:'conversation.deleted',
      payload:{conversation_id:'conversation-one'}});
    const afterDelete=h.db.prepare('SELECT active FROM journal_message_ids WHERE message_id=?').get('old-msg');
    assert.equal(afterDelete.active,0);
    await h.chat('fresh-create','user-one','conversation-new');
    const reuse=await h.post({event_id:'fresh-event',user_id:'user-one',kind:'message.saved',
      payload:{conversation_id:'conversation-new',message_id:'old-msg',role:'user',content:'Would resurrect'}});
    assert.equal(reuse.body.code,'journal_message_id_reused');
    await h.msg('fresh-msg','user-one','conversation-new','Fresh content');
    await h.post({event_id:'delete-everything',user_id:'user-one',kind:'conversations.deleted_all',payload:{}});
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids WHERE active=1').get().n,0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,7);
  }finally{h.close();}
});

const SYNTHETIC_ATOMIC_TURN=Object.freeze({
  conversation_id:'conversation-one',
  user_message_id:'synthetic-question-a',
  assistant_message_id:'synthetic-answer-a',
  user_content:'SYNTHETIC_PROMPT_ATOMIC',
  assistant_content:'SYNTHETIC_RESPONSE_ATOMIC',
  request_id:'synthetic-request-a',
  created_at:1763890800,
  links_json:JSON.stringify([{url:'https://example.invalid/synthetic',title:'Synthetic source'}])
});
const atomicEvent=(event_id='atomic-first',payload=SYNTHETIC_ATOMIC_TURN)=>({
  event_id,user_id:'user-one',kind:'turn.saved',payload
});

test('atomic journal turn stores two message identities with one durable seq and deduplicates identical retries',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();
    const first=await h.post(atomicEvent());
    assert.deepEqual(first,{status:200,body:{ok:true,seq:3,duplicate:false}});
    const same=await h.post(atomicEvent('atomic-first',{
      ...SYNTHETIC_ATOMIC_TURN,conversation_id:'conversation-one'
    }));
    assert.deepEqual(same,{status:200,body:{ok:true,seq:3,duplicate:true}});
    assert.deepEqual(h.db.prepare(
      'SELECT message_id,role,seq,ordinal,active FROM journal_message_ids ORDER BY ordinal').all()
      .map(x=>({...x})),[
        {message_id:'synthetic-question-a',role:'user',seq:3,ordinal:0,active:1},
        {message_id:'synthetic-answer-a',role:'assistant',seq:3,ordinal:1,active:1}
      ]);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM journal_events WHERE kind='turn.saved'").get().n,1);
    assert.deepEqual(h.db.prepare('SELECT request_id,conversation_id,seq FROM journal_turn_requests').all()
      .map(x=>({...x})),[{request_id:'synthetic-request-a',conversation_id:'conversation-one',seq:3}]);
    const goodFeedback=await h.post({event_id:'feedback-atomic',user_id:'user-one',kind:'feedback.set',
      payload:{conversation_id:'conversation-one',message_id:'synthetic-answer-a',
        rating:'helpful',reason:'synthetic only'}});
    assert.equal(goodFeedback.status,200);
  }finally{h.close();}
});

test('atomic request deduplicates across event IDs and rejects identity reuse, malformed link and half-turn',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();
    assert.equal((await h.post(atomicEvent())).status,200);
    const sameRequest=await h.post(atomicEvent('other-event',{
      ...SYNTHETIC_ATOMIC_TURN,user_message_id:'different-question',
      assistant_message_id:'different-answer'
    }));
    assert.deepEqual([sameRequest.status,sameRequest.body.code],[409,'journal_request_id_reused']);
    const sameUserId=await h.post(atomicEvent('other-event',{
      ...SYNTHETIC_ATOMIC_TURN,request_id:'synthetic-new-request',
      assistant_message_id:'different-answer'
    }));
    assert.deepEqual([sameUserId.status,sameUserId.body.code],[409,'journal_message_id_reused']);
    const invalid=[
      {assistant_message_id:'synthetic-question-a'},
      {links_json:'[{"url":"javascript:bad","title":"Synthetic"}]'},
      {links_json:'not-json'},
      {created_at:0},
      {assistant_content:''},
      {request_id:'x'},
      {user_message_id:undefined}
    ];
    for(let i=0;i<invalid.length;i++){
      const payload={...SYNTHETIC_ATOMIC_TURN,...invalid[i],
        request_id:'invalid-request-'+i,user_message_id:'invalid-user-'+i,
        assistant_message_id:'invalid-answer-'+i};
      // Explicit collision must survive the extra synthetic IDs.
      if(i===0)payload.assistant_message_id=payload.user_message_id;
      const res=await h.post(atomicEvent('invalid-event-'+i,payload));
      assert.equal(res.status,400,JSON.stringify(res));
      assert.equal(res.body.code,'invalid_event');
    }
    const altered=await h.post(atomicEvent('atomic-first',{
      ...SYNTHETIC_ATOMIC_TURN,assistant_content:'DIFFERENT_PRIVATE_TEXT'
    }));
    assert.equal(altered.body.code,'event_id_conflict');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_turn_requests').get().n,1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM journal_events WHERE kind='turn.saved'").get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids').get().n,2);
  }finally{h.close();}
});

test('atomic turn is redacted by delete and cannot resurrect old message identities',async()=>{
  const h=fixture();try{
    await h.created();await h.chat();await h.post(atomicEvent());
    const deleted=await h.post({event_id:'delete-atomic-chat',user_id:'user-one',
      kind:'conversation.deleted',payload:{conversation_id:'conversation-one'}});
    assert.equal(deleted.status,200);
    const record=h.db.prepare("SELECT payload_json,redacted FROM journal_events WHERE kind='turn.saved'").get();
    assert.equal(record.payload_json,'{}');
    assert.equal(record.redacted,1);
    const asText=JSON.stringify((await h.read()).body.events);
    assert.equal(asText.includes('SYNTHETIC_PROMPT_ATOMIC'),false);
    assert.equal(asText.includes('SYNTHETIC_RESPONSE_ATOMIC'),false);
    assert.equal(asText.includes('https://example.invalid/synthetic'),false);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids WHERE active=1').get().n,0);
    await h.chat('create-chat-after-deletion','user-one','fresh-conversation');
    const reuse=await h.post(atomicEvent('reuse-atomic',{
      ...SYNTHETIC_ATOMIC_TURN,conversation_id:'fresh-conversation',
      request_id:'different-request-after-delete'
    }));
    assert.equal(reuse.body.code,'journal_message_id_reused');
  }finally{h.close();}
});

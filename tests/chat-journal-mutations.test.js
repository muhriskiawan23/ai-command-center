import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initSyntheticJournal,initSyntheticProjection,appendSyntheticEvent,replaySyntheticJournal}
  from '../tools/recovery/chat-journal-prototype.mjs';

function setup() {
  const journal=new DatabaseSync(':memory:');
  const primary=new DatabaseSync(':memory:');
  initSyntheticJournal(journal);initSyntheticProjection(primary);
  const add=(id,kind,payload={},user_id='person-1')=>
    appendSyntheticEvent(journal,{event_id:id,user_id,kind,payload});
  const close=()=>{journal.close();primary.close();};
  return {journal,primary,add,close};
}
function seed(h) {
  h.add('e-account','account.created');
  h.add('e-conversation','conversation.created',{conversation_id:'conv-1',title:'First chat'});
  h.add('e-old-user','message.saved',{conversation_id:'conv-1',message_id:'msg-1',role:'user',content:'Old prompt'});
  h.add('e-old-assistant','message.saved',{conversation_id:'conv-1',message_id:'msg-2',role:'assistant',content:'Old response'});
}
const messages = db=>db.prepare('SELECT message_id,content FROM recovered_messages ORDER BY rowid').all().map(row=>({...row}));
const replacement = {
  conversation_id:'conv-1',
  old_user_message_id:'msg-1',old_assistant_message_id:'msg-2',
  new_user_message_id:'msg-3',new_assistant_message_id:'msg-4',
  user_content:'Edited prompt',assistant_content:'Regenerated answer'
};

test('replace last turn atomically; regenerate does not duplicate old chat after recovery',()=>{
  const h=setup();try {
    seed(h);
    replaySyntheticJournal(h.journal,h.primary);
    h.add('e-replace','turn.replaced',replacement);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:1,lastSeq:5});
    assert.deepEqual(messages(h.primary),[
      {message_id:'msg-3',content:'Edited prompt'},
      {message_id:'msg-4',content:'Regenerated answer'}
    ]);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:0,lastSeq:5});
    // Entire projection rebuilt from the independent journal after synthetic loss.
    const restored=new DatabaseSync(':memory:');
    try {
      initSyntheticProjection(restored);
      assert.equal(replaySyntheticJournal(h.journal,restored).lastSeq,5);
      assert.deepEqual(messages(restored),messages(h.primary));
    } finally {restored.close();}
  } finally {h.close();}
});

test('stale replace and repeated IDs fail closed without losing original turns',()=>{
  const h=setup();try {
    seed(h);replaySyntheticJournal(h.journal,h.primary);
    h.add('e-duplicate-msg','message.saved',{conversation_id:'conv-1',message_id:'msg-1',role:'user',content:'Duplicate'});
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/UNIQUE constraint failed/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,4);
    assert.deepEqual(messages(h.primary).map(x=>x.content),['Old prompt','Old response']);
  } finally {h.close();}

  const other=setup();try {
    seed(other);
    other.add('e-new-user','message.saved',{conversation_id:'conv-1',message_id:'msg-3',role:'user',content:'Newer user'});
    other.add('e-new-response','message.saved',{conversation_id:'conv-1',message_id:'msg-4',role:'assistant',content:'Newer answer'});
    other.add('e-stale-replace','turn.replaced',{
      ...replacement,new_user_message_id:'msg-5',new_assistant_message_id:'msg-6'
    });
    assert.throws(()=>replaySyntheticJournal(other.journal,other.primary),/journal_stale_turn_replacement/);
    assert.equal(other.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,6);
    assert.equal(messages(other.primary).length,4);
  } finally {other.close();}
});

test('rename + pin + archive restore exact conversation preferences',()=>{
  const h=setup();try {
    seed(h);
    h.add('e-metadata','conversation.updated',{conversation_id:'conv-1',archived:true,pinned:true,title:'Pinned archived'});
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:5,lastSeq:5});
    assert.deepEqual({...h.primary.prepare(
      'SELECT title,pinned,archived FROM recovered_conversations WHERE conversation_id=?'
    ).get('conv-1')},{title:'Pinned archived',pinned:1,archived:1});
    h.add('e-unpin','conversation.updated',{conversation_id:'conv-1',pinned:false,archived:false});
    replaySyntheticJournal(h.journal,h.primary);
    assert.deepEqual({...h.primary.prepare(
      'SELECT title,pinned,archived FROM recovered_conversations WHERE conversation_id=?'
    ).get('conv-1')},{title:'Pinned archived',pinned:0,archived:0});
    assert.throws(()=>h.add('bad-metadata','conversation.updated',{conversation_id:'conv-1',pinned:'true'}),/invalid_journal_event/);
    assert.throws(()=>h.add('empty-metadata','conversation.updated',{conversation_id:'conv-1'}),/invalid_journal_event/);
  } finally {h.close();}
});

test('delete-all cascades owned messages and feedback and prevents stale ID resurrection',()=>{
  const h=setup();try {
    seed(h);
    h.add('e-account-2','account.created',{},'person-2');
    h.add('e-other-conversation','conversation.created',{conversation_id:'conv-2',title:'Other owner'},'person-2');
    h.add('e-other-message','message.saved',{conversation_id:'conv-2',message_id:'msg-other',role:'user',content:'Keep me'},'person-2');
    h.add('e-feedback','feedback.set',{conversation_id:'conv-1',message_id:'msg-2',rating:'up',reason:'Useful'});
    h.add('e-delete-all','conversations.deleted_all');
    replaySyntheticJournal(h.journal,h.primary);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_conversations WHERE user_id=?').get('person-1').n,0);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_messages WHERE user_id=?').get('person-1').n,0);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_feedback').get().n,0);
    assert.deepEqual(messages(h.primary),[{message_id:'msg-other',content:'Keep me'}]);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_conversation_tombstones WHERE user_id=?').get('person-1').n,1);
    assert.throws(()=>h.add('e-attempt-recreate','conversation.created',{conversation_id:'conv-1',title:'Should fail'}),/journal_conversation_id_reused/);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:0,lastSeq:9});
    assert.deepEqual(messages(h.primary),[{message_id:'msg-other',content:'Keep me'}]);
  } finally {h.close();}
});

test('feedback only attaches to owned assistant message; editing removes obsolete feedback',()=>{
  const h=setup();try {
    seed(h);replaySyntheticJournal(h.journal,h.primary);
    h.add('e-feedback','feedback.set',{conversation_id:'conv-1',message_id:'msg-2',rating:'up',reason:'Helpful'});
    replaySyntheticJournal(h.journal,h.primary);
    assert.deepEqual({...h.primary.prepare('SELECT rating,reason FROM recovered_feedback').get()},{rating:'up',reason:'Helpful'});
    h.add('e-update-feedback','feedback.set',{conversation_id:'conv-1',message_id:'msg-2',rating:'down',reason:'Outdated'});
    replaySyntheticJournal(h.journal,h.primary);
    assert.equal(h.primary.prepare('SELECT rating FROM recovered_feedback').get().rating,'down');
    h.add('e-replace','turn.replaced',replacement);
    replaySyntheticJournal(h.journal,h.primary);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_feedback').get().n,0);
    assert.throws(()=>h.add('e-malicious-feedback','feedback.set',{conversation_id:'conv-1',message_id:'msg-4',rating:'up',reason:'wrong owner'},'person-2'),/journal_conversation_ownership_mismatch/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,7);
  } finally {h.close();}
});

test('same event ID is idempotent regardless of payload key order',()=>{
  const h=setup();try {
    const first=h.add('e-account','account.created');
    assert.equal(first.duplicate,false);
    h.add('e-conversation','conversation.created',{conversation_id:'conv-1',title:'same'});
    const repeated=h.add('e-conversation','conversation.created',{title:'same',conversation_id:'conv-1'});
    assert.equal(repeated.duplicate,true);
    assert.throws(()=>h.add('e-conversation','conversation.created',{title:'different',conversation_id:'conv-1'}),/event_id_conflict/);
    assert.equal(replaySyntheticJournal(h.journal,h.primary).lastSeq,2);
  } finally {h.close();}
});

test('journal-first write fails safely when projection crashes and retry recovers once',()=>{
  const h=setup();try {
    seed(h);
    const write=h.add('e-new-message','message.saved',{
      conversation_id:'conv-1',message_id:'msg-3',role:'user',content:'Post-checkpoint user'
    });
    assert.equal(write.duplicate,false);
    // A storage failure between journal durable commit and primary projection.
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary,{
      beforeCheckpoint:e=>{if(e.event_id==='e-new-message')throw Error('synthetic primary outage');}
    }),/synthetic primary outage/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,4);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_messages').get().n,2);
    // Client resubmits same requestId. Its payload is identical; never duplicate.
    assert.equal(h.add('e-new-message','message.saved',{
      conversation_id:'conv-1',message_id:'msg-3',role:'user',content:'Post-checkpoint user'
    }).duplicate,true);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:1,lastSeq:5});
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_messages').get().n,3);
  } finally {h.close();}
});

test('deleted account payloads are redacted without resurrecting chat on fresh replay',()=>{
  const h=setup();try {
    seed(h);
    h.add('e-account-other','account.created',{},'person-2');
    h.add('e-chat-other','conversation.created',{conversation_id:'conv-2',title:'Other chat'},'person-2');
    h.add('e-msg-other','message.saved',{conversation_id:'conv-2',message_id:'msg-other',role:'user',content:'other owner keeps chat'},'person-2');
    replaySyntheticJournal(h.journal,h.primary);
    h.add('e-account-deleted','account.deleted');
    const owned=h.journal.prepare(
      'SELECT kind,payload_json,redacted FROM recovery_journal WHERE user_id=? ORDER BY seq'
    ).all('person-1');
    assert.equal(owned.length,5);
    assert.ok(owned.slice(0,-1).every(x=>x.payload_json==='{}'&&x.redacted===1));
    assert.equal(owned.at(-1).kind,'account.deleted');
    assert.equal(owned.at(-1).redacted,0);
    const data=JSON.stringify(h.journal.prepare('SELECT payload_json FROM recovery_journal').all());
    assert.doesNotMatch(data,/Old prompt|Old response|First chat/);
    assert.match(data,/other owner keeps chat/);
    assert.throws(()=>h.add('e-later','message.saved',{
      conversation_id:'conv-1',message_id:'msg-3',role:'user',content:'cannot resurrect'
    }),/deleted_account_event/);
    assert.equal(replaySyntheticJournal(h.journal,h.primary).lastSeq,8);
    const restored=new DatabaseSync(':memory:');
    try {
      initSyntheticProjection(restored);
      assert.equal(replaySyntheticJournal(h.journal,restored).lastSeq,8);
      assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM recovered_accounts WHERE user_id=?').get('person-1').n,0);
      assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM recovered_messages WHERE user_id=?').get('person-1').n,0);
      assert.deepEqual(restored.prepare('SELECT message_id,content FROM recovered_messages').all().map(row=>({...row})),[
        {message_id:'msg-other',content:'other owner keeps chat'}
      ]);
      assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM recovered_account_tombstones').get().n,1);
    } finally {restored.close();}
  } finally {h.close();}
});

test('manual journal redaction without matching deletion tombstone blocks replay',()=>{
  const h=setup();try {
    seed(h);
    h.journal.prepare("UPDATE recovery_journal SET payload_json='{}',redacted=1 WHERE seq=3").run();
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_unverified_redaction/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,2);
  } finally {h.close();}
});

test('journal prototype is completely disconnected from production Worker and deploy bindings',()=>{
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const config=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/chat-journal-prototype|replaySyntheticJournal|appendSyntheticEvent/);
  assert.doesNotMatch(config,/CHAT_JOURNAL_DO|CHAT_RECOVERY_JOURNAL|recovery_journal/);
});

test('journal admission checks account tombstones and event identity while the write lock is held',()=>{
  const h=setup();
  try {
    const observed=[];
    const guarded={
      exec(sql){ observed.push(sql); return h.journal.exec(sql); },
      prepare(sql){
        if(sql.includes('SELECT event_id FROM recovery_journal') ||
           sql.includes('SELECT seq,user_id,kind,payload_json FROM recovery_journal')) {
          assert.equal(h.journal.isTransaction,true,'preflight must run in BEGIN IMMEDIATE');
        }
        return h.journal.prepare(sql);
      }
    };
    const append=(event_id,kind,payload={})=>
      appendSyntheticEvent(guarded,{event_id,user_id:'person-1',kind,payload});
    const created=append('evt-account-created','account.created');
    assert.equal(created.duplicate,false);
    assert.equal(append('evt-account-created','account.created').duplicate,true);
    assert.equal(h.journal.isTransaction,false);
    assert.throws(()=>append('evt-account-created','account.deleted'),/event_id_conflict/);
    assert.equal(h.journal.isTransaction,false,'conflicting ID must release write lock');
    append('evt-account-deleted','account.deleted');
    assert.equal(append('evt-account-deleted','account.deleted').duplicate,true);
    assert.throws(()=>append('evt-late','account.created'),/deleted_account_event/);
    assert.equal(h.journal.isTransaction,false,'deleted-account check must release write lock');
    assert.equal(h.journal.prepare('SELECT COUNT(*) n FROM recovery_journal').get().n,2);
    assert.ok(observed.some(sql=>sql==='BEGIN IMMEDIATE'));
  } finally {h.close();}
});

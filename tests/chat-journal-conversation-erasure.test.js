import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  initSyntheticJournal,initSyntheticProjection,
  appendSyntheticEvent,replaySyntheticJournal
} from '../tools/recovery/chat-journal-prototype.mjs';

// Two separate, ephemeral SQLite stores. No customer data or Cloudflare writes.
function setup() {
  const journal=new DatabaseSync(':memory:'), primary=new DatabaseSync(':memory:');
  initSyntheticJournal(journal);initSyntheticProjection(primary);
  const add=(event_id,kind,payload={},user_id='owner-one')=>
    appendSyntheticEvent(journal,{event_id,user_id,kind,payload});
  const close=()=>{journal.close();primary.close();};
  add('account-one','account.created');
  add('conversation-one','conversation.created',{conversation_id:'conv-one',title:'Private title'});
  add('message-one','message.saved',{conversation_id:'conv-one',message_id:'msg-one',role:'user',content:'PRIVATE_PROMPT'});
  add('message-two','message.saved',{conversation_id:'conv-one',message_id:'msg-two',role:'assistant',content:'PRIVATE_RESPONSE'});
  add('feedback-one','feedback.set',{conversation_id:'conv-one',message_id:'msg-two',rating:'down',reason:'PRIVATE_FEEDBACK'});
  add('account-two','account.created',{},'owner-two');
  add('conversation-two','conversation.created',{conversation_id:'conv-two',title:'Other owner title'},'owner-two');
  add('message-other','message.saved',{conversation_id:'conv-two',message_id:'msg-other',role:'user',content:'OTHER_OWNER_UNTOUCHED'},'owner-two');
  return {journal,primary,add,close};
}
function persisted(journal){
  return JSON.stringify(journal.prepare('SELECT kind,payload_json,redacted,user_id FROM recovery_journal ORDER BY seq').all());
}
function restore(journal){
  const db=new DatabaseSync(':memory:');initSyntheticProjection(db);
  replaySyntheticJournal(journal,db);
  return db;
}

test('deleting one chat erases all source text, title and feedback but preserves other owner and tombstone',()=>{
  const h=setup();try {
    h.add('delete-one','conversation.deleted',{conversation_id:'conv-one'});
    const raw=persisted(h.journal);
    for(const secret of ['PRIVATE_PROMPT','PRIVATE_RESPONSE','PRIVATE_FEEDBACK','Private title'])
      assert.doesNotMatch(raw,new RegExp(secret));
    assert.match(raw,/OTHER_OWNER_UNTOUCHED/);
    const deleted=h.journal.prepare(
      "SELECT kind,payload_json,redacted FROM recovery_journal WHERE user_id=? AND redacted=1 ORDER BY seq"
    ).all('owner-one');
    assert.equal(deleted.length,4);
    assert.ok(deleted.every(r=>r.payload_json==='{"conversation_id":"conv-one"}'&&r.redacted===1));
    const restored=restore(h.journal);try {
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_messages WHERE user_id=?').get('owner-one').n,0);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_conversations WHERE user_id=?').get('owner-one').n,0);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_feedback').get().n,0);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_conversation_tombstones WHERE user_id=?').get('owner-one').n,1);
      assert.equal(restored.prepare('SELECT content FROM recovered_messages WHERE user_id=?').get('owner-two').content,'OTHER_OWNER_UNTOUCHED');
      assert.deepEqual(replaySyntheticJournal(h.journal,restored),{applied:0,lastSeq:9});
    } finally {restored.close();}
    h.add('recreate-deleted','conversation.created',{conversation_id:'conv-one',title:'Recreate after erase'});
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_conversation_resurrection/);
  } finally {h.close();}
});

test('delete-all erases every owned conversation while keeping other-account content and preventing reuse',()=>{
  const h=setup();try {
    h.add('other-conversation','conversation.created',{conversation_id:'conv-new',title:'SECOND_PRIVATE_TITLE'});
    h.add('other-message','message.saved',{conversation_id:'conv-new',message_id:'msg-new',role:'user',content:'SECOND_PRIVATE_MESSAGE'});
    h.add('delete-all','conversations.deleted_all');
    const raw=persisted(h.journal);
    for(const value of ['PRIVATE_PROMPT','PRIVATE_RESPONSE','PRIVATE_FEEDBACK','Private title','SECOND_PRIVATE_TITLE','SECOND_PRIVATE_MESSAGE'])
      assert.equal(raw.includes(value),false,value+' must be erased from source journal');
    assert.ok(raw.includes('OTHER_OWNER_UNTOUCHED'));
    const restored=restore(h.journal);try {
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_conversation_tombstones WHERE user_id=?').get('owner-one').n,2);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_messages WHERE user_id=?').get('owner-one').n,0);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_messages WHERE user_id=?').get('owner-two').n,1);
    } finally {restored.close();}
    h.add('recreate-duplicate','conversation.created',{conversation_id:'conv-new',title:'Should not revive'});
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_conversation_resurrection/);
  } finally {h.close();}
});

test('cross-owner deletion and fabricated redaction fail without erasing other-account data',()=>{
  const h=setup();try {
    assert.throws(()=>h.add('malicious-delete','conversation.deleted',{conversation_id:'conv-two'}),/journal_conversation_not_active/);
    assert.match(persisted(h.journal),/OTHER_OWNER_UNTOUCHED/);
    h.journal.prepare(
      "UPDATE recovery_journal SET payload_json=?,redacted=1 WHERE event_id='conversation-one'"
    ).run('{"conversation_id":"conv-one"}');
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_unverified_redaction/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,1);
  } finally {h.close();}
});

test('account deletion after a conversation deletion clears even retained conversation IDs from journal payloads',()=>{
  const h=setup();try {
    h.add('delete-one','conversation.deleted',{conversation_id:'conv-one'});
    h.add('delete-account','account.deleted');
    const prior=h.journal.prepare('SELECT payload_json,redacted FROM recovery_journal WHERE user_id=? ORDER BY seq').all('owner-one');
    assert.ok(prior.slice(0,-1).every(row=>row.payload_json==='{}'&&row.redacted===1));
    assert.equal(prior.at(-1).payload_json,'{}');
    const restored=restore(h.journal);try {
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_accounts WHERE user_id=?').get('owner-one').n,0);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_messages WHERE user_id=?').get('owner-two').n,1);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM recovered_account_tombstones WHERE user_id=?').get('owner-one').n,1);
    } finally {restored.close();}
  } finally {h.close();}
});

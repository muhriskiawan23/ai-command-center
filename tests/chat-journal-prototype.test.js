import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  initSyntheticJournal, initSyntheticProjection,
  appendSyntheticEvent, replaySyntheticJournal
} from '../tools/recovery/chat-journal-prototype.mjs';

function setup() {
  // Two genuinely separate in-memory SQLite stores: no cross-store transaction.
  const journal=new DatabaseSync(':memory:');
  const primary=new DatabaseSync(':memory:');
  initSyntheticJournal(journal);
  initSyntheticProjection(primary);
  const push=(event_id,kind,payload={},user_id='account-1')=>
    appendSyntheticEvent(journal,{event_id,kind,payload,user_id});
  const close=()=>{journal.close();primary.close();};
  return {journal,primary,push,close};
}
function sample(h) {
  h.push('event-account-1','account.created');
  h.push('event-conversation-1','conversation.created',{conversation_id:'conv-1',title:'Older conversation'});
  h.push('event-message-1','message.saved',{conversation_id:'conv-1',message_id:'msg-old-user',role:'user',content:'before checkpoint'});
  h.push('event-message-2','message.saved',{conversation_id:'conv-1',message_id:'msg-old-assistant',role:'assistant',content:'old answer'});
}
const messages=db=>db.prepare('SELECT message_id,content FROM recovered_messages ORDER BY rowid').all();

test('post-checkpoint chat is replayed from an independent journal after simulated primary loss',()=>{
  const h=setup();
  try {
    sample(h);
    const first=replaySyntheticJournal(h.journal,h.primary);
    assert.deepEqual(first,{applied:4,lastSeq:4});
    h.push('event-message-3','message.saved',{conversation_id:'conv-1',message_id:'msg-new-user',role:'user',content:'new chat after checkpoint'});
    h.push('event-message-4','message.saved',{conversation_id:'conv-1',message_id:'msg-new-assistant',role:'assistant',content:'new answer after checkpoint'});
    h.push('event-conversation-2','conversation.created',{conversation_id:'conv-2',title:'Created later'});
    h.push('event-message-5','message.saved',{conversation_id:'conv-2',message_id:'msg-new-conversation',role:'user',content:'future chat'});
    // A crash destroys the projection, NOT the independently committed journal.
    h.primary.exec('DROP TABLE recovered_messages; DROP TABLE recovered_conversations; DROP TABLE recovered_account_tombstones; DROP TABLE recovered_conversation_tombstones; DROP TABLE recovered_accounts; DROP TABLE recovery_checkpoint;');
    initSyntheticProjection(h.primary);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:8,lastSeq:8});
    assert.deepEqual(messages(h.primary).map(m=>m.content),[
      'before checkpoint','old answer','new chat after checkpoint','new answer after checkpoint','future chat'
    ]);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_conversations').get().n,2);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:0,lastSeq:8});
  } finally {h.close();}
});

test('journal event IDs are idempotent and conflicting replay payload is rejected',()=>{
  const h=setup();
  try {
    const event={event_id:'stable-request-id',user_id:'account-1',kind:'account.created',payload:{}};
    assert.deepEqual(appendSyntheticEvent(h.journal,event),{seq:1,duplicate:false});
    assert.deepEqual(appendSyntheticEvent(h.journal,event),{seq:1,duplicate:true});
    assert.throws(()=>appendSyntheticEvent(h.journal,{...event,user_id:'account-2'}),/event_id_conflict/);
    assert.equal(h.journal.prepare('SELECT COUNT(*) AS n FROM recovery_journal').get().n,1);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:1,lastSeq:1});
  } finally {h.close();}
});

test('failed projection is rolled back atomically; retry cannot duplicate a turn',()=>{
  const h=setup();
  try {
    sample(h);
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary,{
      beforeCheckpoint:e=>{if(e.event_id==='event-message-1')throw Error('simulated projection crash');}
    }),/simulated projection crash/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,2);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_messages').get().n,0);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:2,lastSeq:4});
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_messages').get().n,2);
    assert.equal(replaySyntheticJournal(h.journal,h.primary).applied,0);
  } finally {h.close();}
});

test('missing intermediate event or unknown payload fails closed without advancing checkpoint',()=>{
  const h=setup();
  try {
    sample(h);
    h.journal.prepare('DELETE FROM recovery_journal WHERE seq=?').run(2);
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_sequence_gap_or_version/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,1);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_conversations').get().n,0);
  } finally {h.close();}
});

test('conversation deletion tombstone prevents restoring deleted content or reusing its ID',()=>{
  const h=setup();
  try {
    sample(h);
    h.push('event-delete-conversation','conversation.deleted',{conversation_id:'conv-1'});
    replaySyntheticJournal(h.journal,h.primary);
    assert.equal(messages(h.primary).length,0);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_conversation_tombstones').get().n,1);
    h.push('event-recreate-conversation','conversation.created',{conversation_id:'conv-1',title:'Should not resurrect'});
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_conversation_resurrection/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,5);
    assert.equal(messages(h.primary).length,0);
  } finally {h.close();}
});

test('account deletion tombstone cascades chats and blocks post-delete appends',()=>{
  const h=setup();
  try {
    sample(h);
    h.push('event-delete-account','account.deleted');
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary),{applied:5,lastSeq:5});
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_accounts').get().n,0);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_messages').get().n,0);
    assert.equal(h.primary.prepare('SELECT COUNT(*) AS n FROM recovered_account_tombstones').get().n,1);
    assert.throws(()=>h.push('event-invalid-after-delete','account.created'),/deleted_account_event/);
    // Synthetic prototype retains source payloads: a real system MUST implement
    // separately reviewed privacy erasure/crypto-shredding before public rollout.
  } finally {h.close();}
});

test('cross-user conversation writes cannot be replayed as owned chat',()=>{
  const h=setup();
  try {
    sample(h);
    h.push('event-account-2','account.created',{},'account-2');
    h.push('event-foreign-message','message.saved',{
      conversation_id:'conv-1',message_id:'foreign-message',role:'user',content:'should be rejected'
    },'account-2');
    assert.throws(()=>replaySyntheticJournal(h.journal,h.primary),/journal_conversation_ownership_mismatch/);
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,5);
    assert.equal(messages(h.primary).length,2);
  } finally {h.close();}
});

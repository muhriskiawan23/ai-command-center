import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  initSyntheticJournal, initSyntheticProjection,
  appendSyntheticEvent, replaySyntheticJournal
} from '../tools/recovery/chat-journal-prototype.mjs';

// Never touches a Cloudflare database or any customer data.
function setup() {
  const journal=new DatabaseSync(':memory:'), primary=new DatabaseSync(':memory:');
  initSyntheticJournal(journal);initSyntheticProjection(primary);
  const add=(event_id,kind,payload={})=>
    appendSyntheticEvent(journal,{event_id,kind,user_id:'owner-1',payload});
  const close=()=>{journal.close();primary.close();};
  add('evt-account','account.created');
  add('evt-conv','conversation.created',{conversation_id:'conv-1',title:'Chat'});
  add('evt-user','message.saved',{conversation_id:'conv-1',message_id:'msg-1',role:'user',content:'Before restore'});
  add('evt-assistant','message.saved',{conversation_id:'conv-1',message_id:'msg-2',role:'assistant',content:'Answer'});
  return {journal,primary,add,close};
}

test('bounded replay refuses to report completion while newer chat is pending',()=>{
  const h=setup();try {
    assert.throws(
      ()=>replaySyntheticJournal(h.journal,h.primary,{maxEvents:2,expectedHeadSeq:4}),
      /journal_replay_incomplete/
    );
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,2);
    assert.equal(h.primary.prepare('SELECT COUNT(*) n FROM recovered_messages').get().n,0);
    assert.deepEqual(replaySyntheticJournal(h.journal,h.primary,{maxEvents:2,expectedHeadSeq:4}),
      {applied:2,lastSeq:4});
    assert.deepEqual(h.primary.prepare('SELECT content FROM recovered_messages ORDER BY rowid').all()
      .map(row=>row.content),['Before restore','Answer']);
  } finally {h.close();}
});

test('independently retained sequence watermark detects missing new chat tail before restoring',()=>{
  const h=setup();try {
    h.journal.prepare('DELETE FROM recovery_journal WHERE seq=4').run();
    assert.throws(
      ()=>replaySyntheticJournal(h.journal,h.primary,{expectedHeadSeq:4}),
      /journal_tail_missing/
    );
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,0);
    assert.throws(
      ()=>replaySyntheticJournal(h.journal,h.primary,{expectedHeadSeq:-1}),
      /invalid_expected_journal_head/
    );
  } finally {h.close();}
});

test('projection checkpoint ahead of truncated journal refuses to claim recovery complete',()=>{
  const h=setup();try {
    assert.equal(replaySyntheticJournal(h.journal,h.primary).lastSeq,4);
    h.journal.prepare('DELETE FROM recovery_journal WHERE seq=4').run();
    assert.throws(
      ()=>replaySyntheticJournal(h.journal,h.primary),
      /journal_checkpoint_ahead_of_source/
    );
  } finally {h.close();}
});

test('account-deleted journal must not retain private payload marked as redacted',()=>{
  const h=setup();try {
    h.add('evt-delete','account.deleted');
    h.journal.prepare('UPDATE recovery_journal SET payload_json=? WHERE seq=2')
      .run('{"title":"private data should have been erased"}');
    assert.throws(
      ()=>replaySyntheticJournal(h.journal,h.primary),
      /journal_invalid_redaction/
    );
    assert.equal(h.primary.prepare('SELECT seq FROM recovery_checkpoint').get().seq,1);
  } finally {h.close();}
});

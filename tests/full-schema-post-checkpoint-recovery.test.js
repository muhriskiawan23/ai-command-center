import test from 'node:test';
import assert from 'node:assert/strict';
import {createFullSchemaSyntheticFixture,fingerprintFullSyntheticSchema}
  from '../tools/recovery/full-schema-synthetic-sqlite-recovery.mjs';
import {createSyntheticTailJournal,addSyntheticTailEvent,
  prepareSyntheticTailCheckpoint,replaySyntheticTailIntoFullSchema,
  drillFullSchemaPostCheckpointRecovery}
  from '../tools/recovery/full-schema-post-checkpoint-recovery.mjs';

const OWNER='synthetic-owner-only';
function setup(){
  const db=createFullSchemaSyntheticFixture();
  prepareSyntheticTailCheckpoint(db);
  const journal=createSyntheticTailJournal();
  const close=()=>{journal.close();db.close();};
  return {db,journal,close};
}
const add=(h,eventId,ownerId,kind,payload)=>addSyntheticTailEvent(h.journal,
  {eventId,ownerId,kind,payload});

test('all 14 migrations: snapshot + verified post-checkpoint tail restore original IDs, session, feedback, image ledger, privacy deletion',async()=>{
  const result=await drillFullSchemaPostCheckpointRecovery();
  for(const key of ['passed','syntheticOnly','atomicPairRollback',
    'postCheckpointTurnPreserved','originalIntegerIdsPreserved',
    'originalSessionPreserved','sourceAndRestoredFingerprintsMatch',
    'deletionTombstonesApplied','noDeletedChatOrAccountResurrection',
    'noDuplicateFeedbackOrImageCharge','foreignKeysClean'])
    assert.equal(result[key],true,key);
  assert.equal(result.migrationsReplayed,14);
  assert.equal(result.tailEventsApplied,5);
  assert.equal(result.checkpoint,5);
  assert.equal(result.cloudflareCalled,false);
  assert.equal(result.productionDataTouched,false);
  assert.equal(result.hostedCloudflareRecoveryProven,false);
});

test('independently pinned expected journal tail head refuses missing event before projection',()=>{
  const h=setup();try{
    add(h,'synthetic-delete-a','synthetic-owner-only','conversation.deleted',
      {conversation_id:'synthetic-chat-archive'});
    const old=fingerprintFullSyntheticSchema(h.db).sha256;
    assert.throws(()=>replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:2}),
      /offline_post_snapshot_missing_tail/);
    assert.equal(fingerprintFullSyntheticSchema(h.db).sha256,old);
  }finally{h.close();}
});

test('payload integrity rejects changed journal bytes before applying any changes',()=>{
  const h=setup();try{
    add(h,'synthetic-delete-b',OWNER,'conversation.deleted',
      {conversation_id:'synthetic-chat-archive'});
    h.journal.prepare('UPDATE synthetic_tail SET payload_json=? WHERE seq=1')
      .run('{"conversation_id":"synthetic-chat-one"}');
    assert.throws(()=>replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:1}),
      /offline_post_snapshot_tampered_tail/);
    assert.equal(h.db.prepare('SELECT seq FROM offline_tail_checkpoint').get().seq,0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,3);
  }finally{h.close();}
});

test('cross-account conversation erasure fails closed, existing privacy rows remain intact',()=>{
  const h=setup();try{
    add(h,'synthetic-cross-owner','synthetic-other-owner','conversation.deleted',
      {conversation_id:'synthetic-chat-archive'});
    assert.throws(()=>replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:1}),
      /offline_post_snapshot_ownership/);
    assert.equal(h.db.prepare('SELECT seq FROM offline_tail_checkpoint').get().seq,0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,4);
    assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('partial application never passes completion; restart resumes checkpoint without duplicate operations',()=>{
  const h=setup();try{
    add(h,'synthetic-delete-archived',OWNER,'conversation.deleted',
      {conversation_id:'synthetic-chat-archive'});
    add(h,'synthetic-delete-second','synthetic-other-owner','account.deleted',{});
    assert.throws(()=>replaySyntheticTailIntoFullSchema(h.db,h.journal,
      {expectedHead:2,maxEvents:1}),/offline_post_snapshot_incomplete_replay/);
    assert.equal(h.db.prepare('SELECT seq FROM offline_tail_checkpoint').get().seq,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,2);
    assert.equal(replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:2}).applied,1);
    assert.equal(replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:2}).applied,0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM offline_tail_deleted_accounts').get().n,1);
    assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.close();}
});

test('deleted account tombstone refuses future forged append after acknowledged deletion',()=>{
  const h=setup();try{
    add(h,'synthetic-account-erasure','synthetic-other-owner','account.deleted',{});
    assert.equal(replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:1}).seq,1);
    add(h,'synthetic-second-erasure','synthetic-other-owner','account.deleted',{});
    assert.throws(()=>replaySyntheticTailIntoFullSchema(h.db,h.journal,{expectedHead:2}),
      /offline_post_snapshot_account_resurrection/);
    assert.equal(h.db.prepare('SELECT seq FROM offline_tail_checkpoint').get().seq,1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM offline_tail_deleted_accounts').get().n,1);
  }finally{h.close();}
});

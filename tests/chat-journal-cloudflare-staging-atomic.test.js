import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {ATOMIC_SYNTHETIC_PURPOSE,approvedAtomicSyntheticDrill,
  executeClosedAtomicSyntheticJournalDrill}
  from '../src/chat-journal-staging-atomic-drill.js';
import {createIsolatedActualChatSchemaOffline, replayVerifiedDoSnapshotIntoActualChatSchemaOffline}
  from '../tools/recovery/replay-do-journal-to-real-chat-schema-offline.mjs';
import {makeJournalStagingConfig} from '../scripts/prepare-chat-journal-staging.mjs';

const secret='SYNTHETIC_STAGING_TEST_SECRET_NEVER_USE_IN_PRODUCTION';
const instanceId='bor-synthetic-atomic-test-001';
const payload={purpose:ATOMIC_SYNTHETIC_PURPOSE};
function mock(){
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(sql,...args){
    const rows=db.prepare(sql).all(...args);return {toArray:()=>rows};
  }},transactionSync(fn){
    db.exec('BEGIN IMMEDIATE');
    try{const value=fn();db.exec('COMMIT');return value;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }};
  const object=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:secret});
  const names=[];
  const env={
    CHAT_JOURNAL_ACTIVE:'false',
    CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY:'true',
    CHAT_JOURNAL_INTERNAL_SECRET:secret,
    CHAT_JOURNAL:{
      idFromName(name){names.push(name);return name;},
      get(){return object;}
    }
  };
  return {db,env,names,close:()=>db.close()};
}

test('v2 purpose gate forbids real-user context, extra fields and invalid IDs without a Durable Object call',async()=>{
  assert.equal(approvedAtomicSyntheticDrill(payload,instanceId),true);
  const m=mock();
  try{
    const bad=[
      {payload:{purpose:'arbitrary'},instanceId},
      {payload:{...payload,user_id:'real-user'},instanceId},
      {payload,instanceId:'../../../user'},
      {payload:null,instanceId},
      {payload,instanceId:'bad'}
    ];
    for(const opts of bad){
      assert.equal(Boolean(approvedAtomicSyntheticDrill(opts.payload,opts.instanceId)),false);
      await assert.rejects(executeClosedAtomicSyntheticJournalDrill(m.env,opts),
        /atomic_staging_drill_not_approved/);
    }
    for(const forbidden of [
      {CHAT_JOURNAL_ACTIVE:'true'},
      {CHAT_JOURNAL_INTERNAL_SECRET:'short'},
      {CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY:'false'},
      {CHAT_JOURNAL:null}
    ]){
      await assert.rejects(executeClosedAtomicSyntheticJournalDrill(
        {...m.env,...forbidden},{payload,instanceId}),
        /atomic_staging_private_bindings_unavailable/);
    }
    assert.equal(m.names.length,0);
    assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,0);
  }finally{m.close();}
});

test('v2 real SQLite-backed DO exercise proves one-seq atomic turns, idempotency and privacy erasure',async()=>{
  const m=mock();
  try{
    const receipt=await executeClosedAtomicSyntheticJournalDrill(m.env,{payload,instanceId});
    assert.deepEqual(receipt,{
      passed:true,drillVersion:2,isolated:true,syntheticOnly:true,
      publicChatAccess:false,independentSQLite:true,
      head:9,events:9,atomicTurns:2,erasedPayloadEvents:8,
      duplicateRetriesVerified:3,requestConflictBlocked:true,
      halfTurnBlocked:true,staleMutationBlocked:true,
      customerDataAccessed:false,productionD1Accessed:false
    });
    assert.deepEqual(m.names,['bor-ai-synthetic-atomic-'+instanceId]);
    const eventRows=m.db.prepare(
      'SELECT seq,kind,payload_json,redacted FROM journal_events ORDER BY seq'
    ).all();
    assert.equal(eventRows.length,9);
    assert.deepEqual(eventRows.filter(x=>x.kind==='turn.saved').map(x=>x.seq),[3,8]);
    assert.ok(eventRows.slice(0,-1).every(x=>x.payload_json==='{}'&&x.redacted===1));
    assert.equal(eventRows[8].kind,'account.deleted');
    assert.equal(eventRows[8].redacted,0);
    // Account deletion now atomically purges private message and request ID
    // indexes (not merely marks their rows inactive); the terminal deletion
    // tombstone and ordered event counts remain replayable.
    assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM journal_turn_requests').get().n,0);
    assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids').get().n,0);
    assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids WHERE active=1').get().n,0);
    const text=JSON.stringify(receipt);
    assert.equal(text.includes(secret),false);
    assert.equal(text.includes('SYNTHETIC_ATOMIC_QUESTION_ONLY'),false);
    assert.equal(text.includes('example.invalid'),false);
  }finally{m.close();}
});

test('v2 Worker stays private and points only to previous isolated staging script and manual Workflow',()=>{
  const conf=makeJournalStagingConfig();
  assert.equal(conf.name,'bor-ai-chat-journal-staging');
  assert.equal(conf.workers_dev,false);
  assert.equal(conf.preview_urls,false);
  assert.equal(conf.vars.CHAT_JOURNAL_ACTIVE,'false');
  assert.equal(conf.vars.CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY,'true');
  assert.equal(conf.workflows.length,1);
  assert.equal(conf.workflows[0].name,'bor-ai-chat-journal-staging-drill-v1');
  assert.equal(conf.durable_objects.bindings.length,1);
  assert.ok(!('d1_databases' in conf)&&!('r2_buckets' in conf));
  assert.ok(!('routes' in conf)&&!('triggers' in conf)&&!('queues' in conf));
  const worker=readFileSync('src/chat-journal-staging-worker.js','utf8');
  assert.match(worker,/status:404/);
  assert.match(worker,/staging_workflow_payload_not_approved/);
  assert.match(worker,/approvedAtomicSyntheticDrill/);
  assert.doesNotMatch(worker,/\/api\/chat|app\.getborai|\.scheduled\(|DB\.prepare|BOR_PRIVATE_D1_EXPORT_TOKEN/);
});

test('a committed DO turn survives D1 rollback and replays once with stable message IDs', async () => {
  const journal = mock();
  const db = createIsolatedActualChatSchemaOffline();
  const owner = {id: 'synthetic-recovery-owner', email: 'owner@example.invalid', name: 'Synthetic owner', picture: ''};
  const conversationId = 'synthetic-recovery-chat';
  const requestId = 'synthetic-recovery-request';
  const createdAt = 1780001234;
  const links = JSON.stringify([{url: 'https://example.invalid/citation', title: 'Synthetic citation'}]);
  const durableObject = journal.env.CHAT_JOURNAL.get();
  async function journalRequest(path, event) {
    const response = await durableObject.fetch(new Request('https://journal.internal' + path, {
      method: event ? 'POST' : 'GET',
      headers: {'X-BOR-Journal-Token': secret, 'Content-Type': 'application/json'},
      body: event ? JSON.stringify(event) : undefined
    }));
    assert.equal(response.status, 200);
    return response.json();
  }
  const event = (event_id, kind, payload = {}) => ({event_id, kind, user_id: owner.id, payload});
  const turn = event('turn-3', 'turn.saved', {
    conversation_id: conversationId, request_id: requestId,
    user_message_id: 'synthetic-question', assistant_message_id: 'synthetic-answer',
    user_content: 'Synthetic question', assistant_content: 'Synthetic answer',
    created_at: createdAt, links_json: links
  });
  const snapshot = async () => {
    const {head, events} = await journalRequest('/read');
    return {userId: owner.id, head, events};
  };
  const checkpoint = () => db.prepare('SELECT seq FROM offline_recovery_guard').get().seq;
  const messages = () => db.prepare('SELECT id, role, content, idempotency_key, links_json, created_at FROM messages ORDER BY id').all();
  try {
    await journalRequest('/append', event('owner-1', 'account.created'));
    await journalRequest('/append', event('chat-2', 'conversation.created', {
      conversation_id: conversationId, title: 'Synthetic recovery chat'
    }));
    const options = {owner, syntheticTimestamp: createdAt - 1};
    replayVerifiedDoSnapshotIntoActualChatSchemaOffline(db, await snapshot(), options);
    assert.equal(checkpoint(), 2);

    const receipt = await journalRequest('/append', turn);
    assert.equal(receipt.seq, 3);
    assert.equal(receipt.duplicate, false);
    const committed = await snapshot();
    const outage = new Error('synthetic D1 outage before checkpoint commit');
    let tentativeIds;
    assert.throws(() => replayVerifiedDoSnapshotIntoActualChatSchemaOffline(db, committed, {
      ...options,
      beforeCheckpoint(entry) {
        assert.equal(entry.seq, 3);
        tentativeIds = messages().map(row => row.id);
        assert.equal(tentativeIds.length, 2);
        throw outage;
      }
    }), outage);
    assert.equal(checkpoint(), 2);
    assert.deepEqual(messages(), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offline_recovery_messages').get().n, 0);

    const retry = await journalRequest('/append', turn);
    assert.equal(retry.seq, receipt.seq);
    assert.equal(retry.duplicate, true);
    const recovered = await snapshot();
    assert.deepEqual(recovered, committed);
    assert.equal(replayVerifiedDoSnapshotIntoActualChatSchemaOffline(db, recovered, options).applied, 1);
    const restored = messages();
    assert.deepEqual(restored.map(row => row.id), tentativeIds);
    assert.deepEqual(restored.map(({role, content, idempotency_key, links_json, created_at}) =>
      [role, content, idempotency_key, links_json, created_at]), [
      ['user', 'Synthetic question', requestId, null, createdAt],
      ['assistant', 'Synthetic answer', null, links, createdAt]
    ]);
    assert.equal(checkpoint(), 3);
    assert.equal(replayVerifiedDoSnapshotIntoActualChatSchemaOffline(db, recovered, options).applied, 0);
    assert.deepEqual(messages(), restored);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    journal.close();
  }
});

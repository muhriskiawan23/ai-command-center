import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {executeClosedSyntheticJournalDrill,isApprovedClosedJournalDrill}
  from '../src/chat-journal-staging-synthetic-drill.js';
import {makeJournalStagingConfig} from '../scripts/prepare-chat-journal-staging.mjs';
const TOKEN='synthetic-staging-only-token-not-a-real-credential-0001';
const instanceId='bor-staging-test-48111122233';
function mock(){
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(sql,...args){return {toArray:()=>db.prepare(sql).all(...args)};}},
    transactionSync(fn){db.exec('BEGIN IMMEDIATE');
      try{const out=fn();db.exec('COMMIT');return out;}
      catch(err){db.exec('ROLLBACK');throw err;}
    }};
  const object=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:TOKEN});
  const names=[];
  const env={
    CHAT_JOURNAL_ACTIVE:'false',CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY:'true',
    CHAT_JOURNAL_INTERNAL_SECRET:TOKEN,
    CHAT_JOURNAL:{idFromName(name){names.push(name);return name;},
      get(){return object;}}
  };
  return {db,env,names,close:()=>db.close()};
}
const payload={purpose:'BOR_SYNTHETIC_CLOSED_JOURNAL_DRILL_V1'};
test('strict isolated Worker and DO config never includes production binding or public route',()=>{
  const conf=makeJournalStagingConfig();
  assert.equal(conf.name,'bor-ai-chat-journal-staging');
  assert.equal(conf.main,'src/chat-journal-staging-worker.js');
  assert.equal(conf.workers_dev,false);
  assert.equal(conf.vars.CHAT_JOURNAL_ACTIVE,'false');
  assert.equal(conf.durable_objects.bindings[0].class_name,'ChatJournalDurableObject');
  assert.deepEqual(conf.migrations,[{tag:'journal-staging-v1',new_sqlite_classes:['ChatJournalDurableObject']}]);
  assert.deepEqual(conf.workflows.map(w=>w.class_name),['ChatJournalSyntheticStagingWorkflow']);
  assert.ok(!('d1_databases' in conf)&&!('r2_buckets' in conf));
  assert.ok(!('routes' in conf)&&!('triggers' in conf)&&!('ai' in conf));
  const worker=readFileSync('src/chat-journal-staging-worker.js','utf8');
  assert.match(worker,/status:404/);
  assert.match(worker,/WorkflowEntrypoint/);
  assert.doesNotMatch(worker,/app\.getborai|\/api\/chat|\/api\/conversations|DB\.prepare|BOR_PRIVATE_D1_EXPORT_TOKEN|scheduled\(/);
});
test('unapproved payload/instance, absent private secret and enabled production flag fail before DO I/O',async()=>{
  assert.equal(isApprovedClosedJournalDrill(payload,instanceId),true);
  for(const bogus of [{purpose:'anything'}, {purpose:'BOR_SYNTHETIC_CLOSED_JOURNAL_DRILL_V1',user_id:'real'},
    {purpose:'BOR_SYNTHETIC_CLOSED_JOURNAL_DRILL_V1',extra:'x'},null,{}]){
    assert.equal(Boolean(isApprovedClosedJournalDrill(bogus,instanceId)),false);
  }
  const m=mock();try{
    const namesBefore=m.names.length;
    for(const opts of [
      {payload:{purpose:'unknown'},instanceId},
      {payload,instanceId:'../bad'},
    ])await assert.rejects(executeClosedSyntheticJournalDrill(m.env,opts),/staging_drill_not_approved/);
    for(const change of [
      {CHAT_JOURNAL_ACTIVE:'true'}, {CHAT_JOURNAL_INTERNAL_SECRET:'small'},
      {CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY:'false'}, {CHAT_JOURNAL:null}
    ])await assert.rejects(executeClosedSyntheticJournalDrill({...m.env,...change},{payload,instanceId}),
      /staging_drill_private_bindings_unavailable/);
    assert.equal(m.names.length,namesBefore);
    assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,0);
  }finally{m.close();}
});
test('single actual SQLite DO roundtrip proves idempotent deletion, redaction, bounded persisted head and no live data',async()=>{
  const m=mock();try{
    const receipt=await executeClosedSyntheticJournalDrill(m.env,{payload,instanceId});
    assert.equal(receipt.passed,true);
    assert.equal(receipt.events,10);
    assert.equal(receipt.head,10);
    assert.equal(receipt.erasedPayloadEvents,9);
    assert.equal(receipt.duplicateDeletionRetriesVerified,2);
    assert.equal(receipt.staleMutationBlocked,true);
    assert.equal(receipt.customerDataAccessed,false);
    assert.equal(receipt.productionD1Accessed,false);
    assert.deepEqual(m.names,['bor-ai-synthetic-only-'+instanceId]);
    const rows=m.db.prepare('SELECT seq,kind,payload_json,redacted FROM journal_events ORDER BY seq').all();
    assert.equal(rows.length,10);
    assert.ok(rows.slice(0,-1).every(x=>x.payload_json==='{}'&&x.redacted===1));
    assert.equal(rows[9].kind,'account.deleted');
    assert.equal(m.db.prepare('SELECT COUNT(*) AS n FROM journal_message_ids WHERE active=1').get().n,0);
    assert.equal(JSON.stringify(receipt).includes(TOKEN),false);
  }finally{m.close();}
});

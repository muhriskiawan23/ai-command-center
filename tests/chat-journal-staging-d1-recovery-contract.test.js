import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ChatJournalDurableObject} from '../src/chat-journal-do.js';
import {PURPOSE,PROD_DB,approved,drill} from '../src/chat-journal-staging-d1-recovery-drill.js';
import {createConfig} from '../scripts/prepare-chat-journal-d1-recovery-staging.mjs';
const runId='45125376134',uuid='8c5f0ad6-b892-48c7-b4c3-5c6e2a890ef0',
  secret='ONLY_SYNTHETIC_STAGING_TEST_PRIVATE_SECRET_12345678',payload={purpose:PURPOSE};
function mock(){
  const journal=new DatabaseSync(':memory:'),d1=new DatabaseSync(':memory:'),names=[];
  const storage={sql:{exec(sql,...args){return {toArray:()=>journal.prepare(sql).all(...args)};}},
    transactionSync(fn){journal.exec('BEGIN IMMEDIATE');
      try{const r=fn();journal.exec('COMMIT');return r;}
      catch(e){journal.exec('ROLLBACK');throw e;}}};
  const object=new ChatJournalDurableObject({storage},{CHAT_JOURNAL_INTERNAL_SECRET:secret});
  const database={async exec(sql){d1.exec(sql);},prepare(sql){
    const st=d1.prepare(sql);
    return {bind(...args){return {
      async first(){return st.get(...args)||null;},
      async all(){return {results:st.all(...args)};},
      _run(){return st.run(...args);}
    };}};
  },async batch(statements){d1.exec('BEGIN IMMEDIATE');
    try{const r=statements.map(x=>x._run());d1.exec('COMMIT');return r;}
    catch(e){d1.exec('ROLLBACK');throw e;}}};
  const env={CHAT_JOURNAL_ACTIVE:'false',RECOVERY_SYNTHETIC_ONLY:'true',
    RECOVERY_RUN_ID:runId,RECOVERY_D1_NAME:'bor-ai-journal-recovery-'+runId,
    RECOVERY_D1_UUID:uuid,CHAT_JOURNAL_INTERNAL_SECRET:secret,RECOVERY_D1:database,
    CHAT_JOURNAL:{idFromName(x){names.push(x);return x;},get(){return object;}}};
  return {env,names,d1,journal,close(){journal.close();d1.close();}};
}
test('fail-closed D1 identity and payload before touching resources',async()=>{
  const f=mock();
  try{
    assert.equal(approved(payload,runId),true);
    assert.equal(approved({...payload,user:'customer'},runId),false);
    await assert.rejects(drill(f.env,{payload:{purpose:'other'},runId}),/staging_recovery_not_approved/);
    for(const props of [{RECOVERY_D1_UUID:PROD_DB},{RECOVERY_D1_NAME:'bor-ai-chat'},
      {RECOVERY_SYNTHETIC_ONLY:'false'},{CHAT_JOURNAL_ACTIVE:'true'},
      {RECOVERY_D1:null},{CHAT_JOURNAL_INTERNAL_SECRET:'short'}]){
      await assert.rejects(drill({...f.env,...props},{payload,runId}),
        /staging_recovery_bindings_invalid/);
    }
    assert.deepEqual(f.names,[]);
    assert.equal(f.d1.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get().n,0);
  }finally{f.close();}
});
test('synthetic DO commit survives failed D1 batch, retry replays 2 messages once',async()=>{
  const f=mock();
  try{
    const r=await drill(f.env,{payload,runId});
    assert.equal(r.passed,true);
    assert.equal(r.restoredMessages,2);
    assert.equal(r.checkpoint,3);
    assert.equal(r.batchAtomic,true);
    assert.equal(r.replayAgainNoOp,true);
    assert.equal(f.journal.prepare('SELECT COUNT(*) AS n FROM journal_events').get().n,3);
    assert.deepEqual(f.d1.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.close();}
});
test('isolated config does not expose production D1 or public Worker',()=>{
  assert.throws(()=>createConfig(runId,PROD_DB),/staging_recovery_invalid_identity/);
  assert.throws(()=>createConfig('../../bad',uuid),/staging_recovery_invalid_identity/);
  const c=createConfig(runId,uuid);
  assert.equal(c.d1_databases[0].database_id,uuid);
  assert.equal(c.workers_dev,false);
  assert.equal(c.preview_urls,false);
  assert.ok(!('routes' in c)&&!('r2_buckets' in c)&&!('assets' in c));
  const worker=readFileSync('src/chat-journal-staging-d1-worker.js','utf8');
  assert.match(worker,/status:404/);
  assert.match(worker,/staging_recovery_workflow_denied/);
  assert.doesNotMatch(worker,/\/api\/chat|app\.getborai|BOR_PRIVATE_D1_EXPORT_TOKEN/);
});

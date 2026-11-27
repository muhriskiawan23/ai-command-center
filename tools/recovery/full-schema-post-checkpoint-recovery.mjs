// NONPRODUCTION synthetic-only end-to-end snapshot + post-checkpoint tail drill.
// Uses all 13 checked-in migrations, in-memory fake source and a disposable
// TEMP-file SQLite restore. No Cloudflare APIs, secrets, real account data,
// customer exports, production Worker integration, or automatic release.
import {DatabaseSync, backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFullSchemaSyntheticFixture,fingerprintFullSyntheticSchema}
  from './full-schema-synthetic-sqlite-recovery.mjs';

const OWNER='synthetic-owner-only';
const OTHER='synthetic-other-owner';
const OWNERS=new Set([OWNER,OTHER]);
const KINDS=new Set(['turn.saved','feedback.set','conversation.updated',
  'conversation.deleted','account.deleted']);
const fail=reason=>{throw Error('offline_post_snapshot_'+reason);};
const get=(db,sql,...args)=>db.prepare(sql).get(...args);
const run=(db,sql,...args)=>db.prepare(sql).run(...args);
const json=value=>JSON.stringify(value);
const digest=(id,owner,kind,payload)=>
  createHash('sha256').update(json([id,owner,kind,payload])).digest('hex');

export function createSyntheticTailJournal(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE synthetic_tail('+
    'seq INTEGER PRIMARY KEY AUTOINCREMENT,'+
    'event_id TEXT NOT NULL UNIQUE,'+
    'owner_id TEXT NOT NULL,'+
    'kind TEXT NOT NULL,'+
    'payload_json TEXT NOT NULL,'+
    'digest TEXT NOT NULL)');
  return db;
}
export function addSyntheticTailEvent(journal,{eventId,ownerId,kind,payload}){
  if(!/^synthetic-[a-z0-9-]{4,80}$/.test(eventId||'')||
     !OWNERS.has(ownerId)||!KINDS.has(kind)||!payload||
     typeof payload!=='object'||Array.isArray(payload))
    fail('invalid_event');
  const encoded=json(payload);
  if(encoded.length>4000)fail('oversized_event');
  const result=run(journal,
    'INSERT INTO synthetic_tail(event_id,owner_id,kind,payload_json,digest) VALUES(?,?,?,?,?)',
    eventId,ownerId,kind,encoded,digest(eventId,ownerId,kind,encoded));
  return Number(result.lastInsertRowid);
}
export function prepareSyntheticTailCheckpoint(db){
  db.exec("CREATE TABLE offline_tail_checkpoint(singleton INTEGER PRIMARY KEY CHECK(singleton=1),seq INTEGER NOT NULL);"+
    "INSERT INTO offline_tail_checkpoint(singleton,seq) VALUES(1,0);"+
    "CREATE TABLE offline_tail_deleted_conversations(id TEXT PRIMARY KEY);"+
    "CREATE TABLE offline_tail_deleted_accounts(id TEXT PRIMARY KEY)");
}
export function replaySyntheticTailIntoFullSchema(db,journal,{
  expectedHead, afterFirstMessage=()=>{}, beforeCheckpoint=()=>{},maxEvents=100
}={}){
  if(!Number.isSafeInteger(expectedHead)||expectedHead<1||expectedHead>100||
     !Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>100)
    fail('invalid_watermark');
  const events=journal.prepare(
    'SELECT seq,event_id,owner_id,kind,payload_json,digest FROM synthetic_tail ORDER BY seq'
  ).all();
  // Verify the INDEPENDENT pre-supplied head, not merely MAX(seq). This rejects
  // missing tail and holes before any projection, but is not cryptographic auth.
  if(events.length!==expectedHead)fail('missing_tail');
  for(let index=0;index<events.length;index++){
    const e=events[index];
    if(e.seq!==index+1||!OWNERS.has(e.owner_id)||!KINDS.has(e.kind)||
       digest(e.event_id,e.owner_id,e.kind,e.payload_json)!==e.digest)
      fail('tampered_tail');
  }
  const start=get(db,'SELECT seq FROM offline_tail_checkpoint WHERE singleton=1')?.seq;
  if(!Number.isSafeInteger(start)||start<0||start>expectedHead)
    fail('checkpoint_invalid');
  let applied=0;
  for(const e of events.slice(start)){
    if(applied>=maxEvents)break;
    db.exec('BEGIN IMMEDIATE');
    try{
      const last=get(db,'SELECT seq FROM offline_tail_checkpoint WHERE singleton=1')?.seq;
      if(last!==e.seq-1)fail('checkpoint_gap');
      const payload=JSON.parse(e.payload_json);
      if(!payload||typeof payload!=='object'||Array.isArray(payload))
        fail('bad_payload');
      if(get(db,'SELECT 1 FROM offline_tail_deleted_accounts WHERE id=?',e.owner_id))
        fail('account_resurrection');
      if(e.kind==='turn.saved'){
        if(e.owner_id!==OWNER||payload.conversation_id!=='synthetic-chat-one'||
           payload.user_message_id!==1101||payload.assistant_message_id!==1102||
           payload.request_id!=='synthetic-new-request'||payload.created_at!==1780000101||
           payload.user_content!=='SYNTHETIC_NEW_PROMPT'||
           payload.assistant_content!=='SYNTHETIC_NEW_RESPONSE'||
           payload.links_json!==json([{url:'https://example.invalid/new-citation',title:'Synthetic only'}]))
          fail('turn_invalid');
        if(!get(db,'SELECT 1 FROM conversations WHERE id=? AND user_id=?',
          payload.conversation_id,e.owner_id))fail('ownership');
        run(db,'INSERT INTO messages(id,conversation_id,user_id,role,content,created_at,idempotency_key) VALUES(?,?,?,?,?,?,?)',
          payload.user_message_id,payload.conversation_id,e.owner_id,'user',
          payload.user_content,payload.created_at,payload.request_id);
        afterFirstMessage(e);
        run(db,'INSERT INTO messages(id,conversation_id,user_id,role,content,created_at,links_json) VALUES(?,?,?,?,?,?,?)',
          payload.assistant_message_id,payload.conversation_id,e.owner_id,'assistant',
          payload.assistant_content,payload.created_at,payload.links_json);
      }else if(e.kind==='feedback.set'){
        if(e.owner_id!==OWNER||payload.conversation_id!=='synthetic-chat-one'||
           payload.message_id!==1102||payload.rating!=='helpful'||
           payload.reason!=='SYNTHETIC_NEW_FEEDBACK')fail('feedback_invalid');
        if(!get(db,"SELECT 1 FROM messages WHERE id=? AND role='assistant' AND user_id=? AND conversation_id=?",
          payload.message_id,e.owner_id,payload.conversation_id))fail('ownership');
        run(db,'INSERT INTO answer_feedback(id,user_id,conversation_id,message_id,rating,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
          92,e.owner_id,payload.conversation_id,payload.message_id,payload.rating,
          payload.reason,1780000102,1780000102);
      }else if(e.kind==='conversation.updated'){
        if(e.owner_id!==OWNER||payload.conversation_id!=='synthetic-chat-one'||
           payload.title!=='SYNTHETIC_UPDATED_TITLE'||payload.pinned!==false||
           payload.archived!==true)fail('update_invalid');
        if(run(db,'UPDATE conversations SET title=?,pinned=0,archived=1,updated_at=? WHERE id=? AND user_id=?',
          payload.title,1780000103,payload.conversation_id,e.owner_id).changes!==1)
          fail('ownership');
      }else if(e.kind==='conversation.deleted'){
        if(payload.conversation_id!=='synthetic-chat-archive')fail('delete_invalid');
        if(!get(db,'SELECT 1 FROM conversations WHERE id=? AND user_id=?',
          payload.conversation_id,e.owner_id))fail('ownership');
        if(run(db,'DELETE FROM conversations WHERE id=? AND user_id=?',
          payload.conversation_id,e.owner_id).changes!==1)fail('ownership');
        run(db,'INSERT INTO offline_tail_deleted_conversations(id) VALUES(?)',
          payload.conversation_id);
      }else if(e.kind==='account.deleted'){
        if(e.owner_id!==OTHER||Object.keys(payload).length!==0)
          fail('account_delete_invalid');
        if(run(db,'DELETE FROM users WHERE id=?',e.owner_id).changes!==1)
          fail('ownership');
        run(db,'INSERT INTO offline_tail_deleted_accounts(id) VALUES(?)',e.owner_id);
      }else fail('unsupported_event');
      beforeCheckpoint(e);
      if(run(db,'UPDATE offline_tail_checkpoint SET seq=? WHERE singleton=1 AND seq=?',
          e.seq,last).changes!==1)fail('checkpoint_conflict');
      db.exec('COMMIT');
      applied++;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  const seq=get(db,'SELECT seq FROM offline_tail_checkpoint WHERE singleton=1')?.seq;
  if(seq!==expectedHead)fail('incomplete_replay');
  if(get(db,'PRAGMA integrity_check')?.integrity_check!=='ok'||
     db.prepare('PRAGMA foreign_key_check').all().length!==0)
    fail('integrity');
  return Object.freeze({applied,seq,complete:true,syntheticOnly:true,
    productionD1Accessed:false,cloudflareCalled:false});
}

const events=Object.freeze([
  ['synthetic-new-turn',OWNER,'turn.saved',{
    conversation_id:'synthetic-chat-one',user_message_id:1101,assistant_message_id:1102,
    request_id:'synthetic-new-request',created_at:1780000101,
    user_content:'SYNTHETIC_NEW_PROMPT',assistant_content:'SYNTHETIC_NEW_RESPONSE',
    links_json:json([{url:'https://example.invalid/new-citation',title:'Synthetic only'}])
  }],
  ['synthetic-new-feedback',OWNER,'feedback.set',{
    conversation_id:'synthetic-chat-one',message_id:1102,
    rating:'helpful',reason:'SYNTHETIC_NEW_FEEDBACK'
  }],
  ['synthetic-new-metadata',OWNER,'conversation.updated',{
    conversation_id:'synthetic-chat-one',title:'SYNTHETIC_UPDATED_TITLE',pinned:false,archived:true
  }],
  ['synthetic-delete-archive',OWNER,'conversation.deleted',{conversation_id:'synthetic-chat-archive'}],
  ['synthetic-delete-other',OTHER,'account.deleted',{}]
]);

export async function drillFullSchemaPostCheckpointRecovery(){
  const folder=mkdtempSync(join(tmpdir(),'bor-ai-synthetic-tail-'));
  const pathname=join(folder,'synthetic-snapshot.sqlite');
  let source,restored,journal;
  try{
    source=createFullSchemaSyntheticFixture();
    prepareSyntheticTailCheckpoint(source);
    const before=fingerprintFullSyntheticSchema(source);
    const pages=await backup(source,pathname);
    if(!Number.isSafeInteger(pages)||pages<1)fail('snapshot_failed');
    journal=createSyntheticTailJournal();
    for(const [eventId,ownerId,kind,payload] of events)
      addSyntheticTailEvent(journal,{eventId,ownerId,kind,payload});
    const expectedHead=events.length;
    const current=replaySyntheticTailIntoFullSchema(source,journal,{expectedHead});
    if(current.seq!==expectedHead)fail('source_not_applied');

    restored=new DatabaseSync(pathname);
    restored.exec('PRAGMA foreign_keys=ON');
    if(fingerprintFullSyntheticSchema(restored).sha256!==before.sha256)
      fail('snapshot_mismatch');
    let crashed=false;
    try{
      replaySyntheticTailIntoFullSchema(restored,journal,{expectedHead,
        afterFirstMessage:()=>{throw Error('synthetic_crash_after_first_of_pair');}});
    }catch(e){
      if(e.message!=='synthetic_crash_after_first_of_pair')throw e;
      crashed=true;
    }
    if(!crashed||
      get(restored,'SELECT seq FROM offline_tail_checkpoint WHERE singleton=1')?.seq!==0||
      get(restored,'SELECT COUNT(*) AS n FROM messages WHERE id IN (1101,1102)')?.n!==0)
      fail('atomic_rollback_failed');
    const projected=replaySyntheticTailIntoFullSchema(restored,journal,{expectedHead});
    const again=replaySyntheticTailIntoFullSchema(restored,journal,{expectedHead});
    const finalSource=fingerprintFullSyntheticSchema(source);
    const finalRestored=fingerprintFullSyntheticSchema(restored);
    if(projected.applied!==5||again.applied!==0||
       finalSource.sha256!==finalRestored.sha256)
      fail('full_schema_post_checkpoint_drift');

    const count=(sql,...args)=>get(restored,sql,...args)?.n;
    if(count('SELECT COUNT(*) AS n FROM messages WHERE id IN (1001,1002,1101,1102)')!==4||
       count('SELECT COUNT(*) AS n FROM messages WHERE id IN (1003,1004)')!==0||
       count('SELECT COUNT(*) AS n FROM answer_feedback WHERE id IN (91,92)')!==2||
       count('SELECT COUNT(*) AS n FROM users')!==1||
       count('SELECT COUNT(*) AS n FROM conversations')!==1||
       count('SELECT COUNT(*) AS n FROM sessions')!==1||
       count('SELECT COUNT(*) AS n FROM image_jobs')!==1||
       count('SELECT COUNT(*) AS n FROM image_credit_ledger')!==2||
       get(restored,'SELECT balance FROM image_wallets WHERE user_id=?',OWNER)?.balance!==6||
       get(restored,'SELECT admitted_count FROM image_pilot_meter WHERE singleton=1')?.admitted_count!==1||
       get(restored,'SELECT message_id FROM answer_feedback WHERE id=92')?.message_id!==1102||
       get(restored,'SELECT idempotency_key FROM messages WHERE id=1101')?.idempotency_key!=='synthetic-new-request'||
       !get(restored,'SELECT links_json FROM messages WHERE id=1102')?.links_json||
       count('SELECT COUNT(*) AS n FROM offline_tail_deleted_conversations')!==1||
       count('SELECT COUNT(*) AS n FROM offline_tail_deleted_accounts')!==1)
      fail('result_invariants_failed');
    return Object.freeze({passed:true,syntheticOnly:true,
      migrationsReplayed:before.migrationCount,tailEventsApplied:5,checkpoint:5,
      atomicPairRollback:true,postCheckpointTurnPreserved:true,
      originalIntegerIdsPreserved:true,originalSessionPreserved:true,
      sourceAndRestoredFingerprintsMatch:true,deletionTombstonesApplied:true,
      noDeletedChatOrAccountResurrection:true,noDuplicateFeedbackOrImageCharge:true,
      foreignKeysClean:true,cloudflareCalled:false,productionDataTouched:false,
      hostedCloudflareRecoveryProven:false});
  }finally{
    try{restored?.close();}finally{
      try{journal?.close();}finally{
        try{source?.close();}finally{rmSync(folder,{recursive:true,force:true});}
      }
    }
  }
}

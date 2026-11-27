// Offline FULL-CHECKED-IN-SCHEMA SQLite backup/restore fidelity drill.
// No Cloudflare calls, no D1 API, no real user data, no secrets and no paid
// services. This does NOT verify Cloudflare's production SQL export or RPO.
// Uses only hardcoded, fake rows; never accept a caller-supplied real DB path.
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const migrationsDir=fileURLToPath(new URL('../../migrations/',import.meta.url));
export const REVIEWED_MIGRATIONS=Object.freeze([
  '0001_auth_and_chat.sql','0002_daily_usage.sql',
  '0003_user_memory.sql','0004_conversation_pinning.sql',
  '0005_conversation_archive.sql','0006_chat_request_idempotency.sql',
  '0007_answer_feedback.sql','0008_message_link_sources.sql',
  '0009_public_api_keys.sql','0010_github_connections.sql',
  '0011_search_provider_usage.sql','0012_image_jobs.sql',
  '0016_image_chat_history.sql','0017_web_search_v2_usage.sql',
  '0018_web_search_v2_user_usage.sql'
]);

function ensureReviewedMigrations(){
  const actual=readdirSync(migrationsDir).filter(x=>/^\d+_.*\.sql$/.test(x)).sort();
  if(JSON.stringify(actual)!==JSON.stringify(REVIEWED_MIGRATIONS))
    throw Error('full_schema_drill_unreviewed_migration_drift');
}
const run=(db,sql,...args)=>db.prepare(sql).run(...args);
const one=(db,sql,...args)=>db.prepare(sql).get(...args);
const fail=(reason)=>{throw Error(reason);};

// All names/rows are invented, use .invalid domains and no real credentials.
export function createFullSchemaSyntheticFixture(){
  ensureReviewedMigrations();
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON');
    for(const migration of REVIEWED_MIGRATIONS)
      db.exec(readFileSync(join(migrationsDir,migration),'utf8'));

    const t=1780000000;
    const user='synthetic-owner-only', other='synthetic-other-owner';
    const addUser=(id,email)=>run(db,
      'INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      id,email,'SYNTHETIC_PERSON','',t,t);
    addUser(user,'only-fake@example.invalid');
    addUser(other,'only-fake-2@example.invalid');

    run(db,'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      'synthetic-session-hash-not-a-credential',user,t+7200,t);
    run(db,'INSERT INTO conversations(id,user_id,title,created_at,updated_at,pinned,archived) VALUES(?,?,?,?,?,?,?)',
      'synthetic-chat-one',user,'SYNTHETIC_TITLE',t,t,1,0);
    run(db,'INSERT INTO conversations(id,user_id,title,created_at,updated_at,pinned,archived) VALUES(?,?,?,?,?,?,?)',
      'synthetic-chat-archive',user,'SYNTHETIC_ARCHIVE',t,t,0,1);
    run(db,'INSERT INTO conversations(id,user_id,title,created_at,updated_at,pinned,archived) VALUES(?,?,?,?,?,?,?)',
      'synthetic-other-chat',other,'SYNTHETIC_OTHER_OWNER',t,t,0,0);

    run(db,'INSERT INTO messages(id,conversation_id,user_id,role,content,created_at,idempotency_key,links_json) VALUES(?,?,?,?,?,?,?,?)',
      1001,'synthetic-chat-one',user,'user','SYNTHETIC_PROMPT',t,
      'synthetic-idempotency-only',null);
    run(db,'INSERT INTO messages(id,conversation_id,user_id,role,content,created_at,idempotency_key,links_json) VALUES(?,?,?,?,?,?,?,?)',
      1002,'synthetic-chat-one',user,'assistant','SYNTHETIC_RESPONSE',t+1,null,
      JSON.stringify([{url:'https://example.invalid/synthetic-source',title:'Synthetic citation'}]));
    run(db,'INSERT INTO messages(id,conversation_id,user_id,role,content,created_at,idempotency_key,links_json) VALUES(?,?,?,?,?,?,?,?)',
      1003,'synthetic-chat-archive',user,'user','SYNTHETIC_ARCHIVED_PROMPT',t+2,null,null);
    run(db,'INSERT INTO messages(id,conversation_id,user_id,role,content,created_at,idempotency_key,links_json) VALUES(?,?,?,?,?,?,?,?)',
      1004,'synthetic-other-chat',other,'assistant','SYNTHETIC_OTHER_RESPONSE',t+3,null,null);

    run(db,'INSERT INTO answer_feedback(id,user_id,conversation_id,message_id,rating,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      91,user,'synthetic-chat-one',1002,'helpful','SYNTHETIC_FEEDBACK',t+4,t+4);
    run(db,'INSERT INTO user_settings(user_id,memory_enabled,updated_at) VALUES(?,?,?)',user,1,t);
    run(db,'INSERT INTO user_memories(id,user_id,content,created_at,updated_at) VALUES(?,?,?,?,?)',
      'synthetic-memory-id',user,'SYNTHETIC_MEMORY_ONLY',t,t);
    run(db,'INSERT INTO daily_usage(day,subject,units,updated_at) VALUES(?,?,?,?)',
      '2026-11-23','user:synthetic-owner-only',4,t);
    run(db,'INSERT INTO daily_usage(day,subject,units,updated_at) VALUES(?,?,?,?)',
      '2026-11-23','global',5,t);

    run(db,'INSERT INTO public_api_keys(id,user_id,key_hash,label,allowed_origins,daily_limit,daily_used,usage_day,created_at,updated_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      'synthetic-api-record',user,'a'.repeat(64),'SYNTHETIC_KEY_LABEL',
      JSON.stringify(['https://example.invalid']),100,2,'2026-11-23',t,t,null);
    run(db,'INSERT INTO github_oauth_states(state_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      'synthetic-oauth-state-not-secret',user,t+900,t);
    run(db,'INSERT INTO github_connections(user_id,github_user_id,github_login,github_avatar_url,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,connected_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      user,9000100,'synthetic-github-only','',
      'SYNTHETIC_CIPHERTEXT_NOT_A_TOKEN',null,t+3600,null,t,t);
    run(db,'INSERT INTO search_provider_usage(day,provider,requests,attempts,successes,failures,rate_limited,last_reason,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      '2026-11-23','tavily',4,5,4,1,0,'synthetic_only',t);

    // Exercise both ledger triggers before the snapshot.
    const searchDay='2026-11-23', searchSubject='b'.repeat(64);
    run(db,'INSERT INTO web_search_v2_user_usage(day,subject,calls,reserved_micro_usd) VALUES(?,?,?,?)',
      searchDay,searchSubject,1,260000);
    run(db,'UPDATE web_search_v2_user_usage SET calls=2,reserved_micro_usd=520000 WHERE day=? AND subject=?',
      searchDay,searchSubject);
    const searchUsage=one(db,'SELECT calls,reserved_micro_usd FROM web_search_v2_usage WHERE day=?',searchDay);
    if(searchUsage?.calls!==2||searchUsage.reserved_micro_usd!==520000)
      fail('full_schema_drill_search_usage_trigger_failed');

    // Real image triggers reserve credit, append ledger entries and increment
    // the pilot meter. We DO NOT manually duplicate their side effects.
    run(db,'INSERT INTO image_credit_ledger(user_id,job_id,event,delta,reference,created_at) VALUES(?,?,?,?,?,?)',
      user,null,'grant',9,'synthetic-credit-grant',t);
    run(db,'INSERT INTO image_jobs(id,user_id,request_id,request_hash,mode,prompt,model,output_format,size,status,source_key,source_mime,output_key,output_bytes,credits,tariff_version,error_code,usage_json,created_at,updated_at,expires_at,conversation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      'synthetic-image-job',user,'synthetic-image-request',
      'synthetic-image-hash','generate','SYNTHETIC_IMAGE_PROMPT',
      'synthetic-model','png','1024x1024','completed',null,null,
      'synthetic/no-real-r2-object.png',345,3,'synthetic-tariff-v1',
      null,'{"synthetic":true}',t,t,t+86400,'synthetic-chat-one');

    if(one(db,'SELECT balance FROM image_wallets WHERE user_id=?',user)?.balance!==6 ||
       one(db,'SELECT admitted_count FROM image_pilot_meter WHERE singleton=1')?.admitted_count!==1 ||
       one(db,'SELECT COUNT(*) AS n FROM image_credit_ledger WHERE user_id=?',user)?.n!==2 ||
       one(db,'SELECT COUNT(*) AS n FROM messages')?.n!==4)
      fail('full_schema_drill_synthetic_seed_invariant_failed');
    verifySqlite(db);
    return db;
  }catch(error){db.close();throw error;}
}

const qi=name=>{
  if(!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name))fail('full_schema_drill_invalid_table_name');
  return '"'+name+'"';
};
const schema=db=>db.prepare(
  "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
).all().map(x=>({type:x.type,name:x.name,table:x.tbl_name,sql:x.sql}));
const names=db=>db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map(x=>x.name);
const rows=(db,table)=>db.prepare('SELECT * FROM '+qi(table)+' ORDER BY rowid').all()
  .map(row=>Object.fromEntries(Object.entries(row)));
const sequence=db=>db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()
  .map(x=>({name:x.name,seq:x.seq}));

function verifySqlite(db){
  const integrity=one(db,'PRAGMA integrity_check');
  if(integrity?.integrity_check!=='ok')fail('full_schema_drill_sqlite_integrity_failed');
  if(db.prepare('PRAGMA foreign_key_check').all().length!==0)
    fail('full_schema_drill_foreign_key_violation');
}

export function fingerprintFullSyntheticSchema(db){
  verifySqlite(db);
  const tables=names(db);
  if(tables.length<15||!tables.includes('messages')||
     !tables.includes('image_jobs')||!tables.includes('answer_feedback')||
     !tables.includes('github_connections')||!tables.includes('sqlite_sequence')&&
       db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='sqlite_sequence'").get().n!==1)
    fail('full_schema_drill_missing_required_tables');
  const ddl=schema(db);
  const content=tables.map(name=>({name,rows:rows(db,name)}));
  const obj={ddl,tables:content,sequence:sequence(db)};
  const sha256=createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  return Object.freeze({
    sha256,tableCount:tables.length,
    indexCount:ddl.filter(x=>x.type==='index').length,
    triggerCount:ddl.filter(x=>x.type==='trigger').length,
    rowCounts:Object.fromEntries(content.map(t=>[t.name,t.rows.length])),
    migrationCount:REVIEWED_MIGRATIONS.length
  });
}

// Run backup to a securely named TEMP file only, open as isolated restored DB,
// verify full row/DDL/trigger/FK/sequence parity, then clean in finally.
// Never accepts arbitrary paths or production DB handles from callers.
export async function runFullSchemaSyntheticSqliteRestoreDrill(){
  const folder=mkdtempSync(join(tmpdir(),'bor-ai-fake-schema-'));
  const file=join(folder,'fake-recovered.sqlite');
  let source,restored;
  let outcome;
  try{
    source=createFullSchemaSyntheticFixture();
    const before=fingerprintFullSyntheticSchema(source);
    const pages=await backup(source,file);
    if(!Number.isSafeInteger(pages)||pages<1)
      fail('full_schema_drill_backup_failed');
    restored=new DatabaseSync(file);
    restored.exec('PRAGMA foreign_keys=ON');
    const after=fingerprintFullSyntheticSchema(restored);
    if(after.sha256!==before.sha256||
       JSON.stringify(before.rowCounts)!==JSON.stringify(after.rowCounts)||
       after.indexCount!==before.indexCount||after.triggerCount!==before.triggerCount)
      fail('full_schema_drill_restore_mismatch');
    const answer=one(restored,'SELECT message_id FROM answer_feedback WHERE id=91');
    const image=one(restored,'SELECT conversation_id FROM image_jobs WHERE id=?',
      'synthetic-image-job');
    const restoredMessage=one(restored,'SELECT id,links_json,idempotency_key FROM messages WHERE id=1002');
    if(answer?.message_id!==1002||image?.conversation_id!=='synthetic-chat-one'||
       !restoredMessage?.links_json||
       one(restored,'SELECT idempotency_key FROM messages WHERE id=1001')
         ?.idempotency_key!=='synthetic-idempotency-only')
      fail('full_schema_drill_dependent_reference_lost');
    // Both original and recreated objects retain the same next autoincrement ID.
    const originalNext=sequence(source).find(x=>x.name==='messages')?.seq;
    const restoredNext=sequence(restored).find(x=>x.name==='messages')?.seq;
    if(originalNext!==1004||restoredNext!==1004)
      fail('full_schema_drill_autoincrement_drift');
    outcome=Object.freeze({
      passed:true,syntheticOnly:true,cloudflareCalled:false,
      productionD1Touched:false,checkpointRpoProven:false,
      migrationCount:before.migrationCount,tableCount:before.tableCount,
      indexCount:before.indexCount,triggerCount:before.triggerCount,
      sha256:after.sha256,originalIntegerMessageIdsPreserved:true,
      syntheticSessionRowsPreserved:true,syntheticLinkSourcesPreserved:true,
      syntheticImageAssociationPreserved:true,foreignKeysValid:true,
      originalRealUserDataProven:false,cloudflareSqlExportProven:false
    });
  }finally{
    try{restored?.close();}finally{
      try{source?.close();}finally{rmSync(folder,{recursive:true,force:true});}
    }
  }
  return Object.freeze({...outcome,temporaryFilesDeleted:true});
}

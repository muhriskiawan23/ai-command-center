// Private, synthetic-only DO-to-D1 disaster drill for a brand-new staging D1.
// Deliberately limited chat-core schema; never import into production Worker.
export const PURPOSE='BOR_SYNTHETIC_CLOSED_DO_D1_RECOVERY_V1';
export const PROD_DB='d71231a9-9a04-471c-b904-d1bc843940aa';
const fail=x=>{throw Error(x);};
export const approved=(purpose,runId)=>purpose&&typeof purpose==='object'&&
  !Array.isArray(purpose)&&Object.keys(purpose).length===1&&purpose.purpose===PURPOSE&&
  /^[0-9]{8,18}$/.test(runId||'');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export async function drill(env,{payload,runId}={}){
  if(!approved(payload,runId))fail('staging_recovery_not_approved');
  if(env?.CHAT_JOURNAL_ACTIVE!=='false'||env?.RECOVERY_SYNTHETIC_ONLY!=='true'||
    env?.RECOVERY_RUN_ID!==runId||env?.RECOVERY_D1_NAME!=='bor-ai-journal-recovery-'+runId||
    !UUID.test(env?.RECOVERY_D1_UUID||'')||env.RECOVERY_D1_UUID.toLowerCase()===PROD_DB||
    typeof env?.CHAT_JOURNAL_INTERNAL_SECRET!=='string'||env.CHAT_JOURNAL_INTERNAL_SECRET.length<32||
    !env?.CHAT_JOURNAL?.idFromName||!env?.CHAT_JOURNAL?.get||
    !env?.RECOVERY_D1?.batch||!env?.RECOVERY_D1?.prepare||!env?.RECOVERY_D1?.exec)
    fail('staging_recovery_bindings_invalid');
  const db=env.RECOVERY_D1, secret=env.CHAT_JOURNAL_INTERNAL_SECRET;
  const stub=env.CHAT_JOURNAL.get(env.CHAT_JOURNAL.idFromName('synthetic-recovery-'+runId));
  const uid='synthetic-owner-'+runId,cid='synthetic-chat-'+runId,rid='synthetic-request-'+runId;
  const stamp=1780001234, links=JSON.stringify([{url:'https://example.invalid/cite',title:'Synthetic citation'}]);
  const turn={conversation_id:cid,request_id:rid,user_message_id:'synthetic-u-'+runId,
    assistant_message_id:'synthetic-a-'+runId,user_content:'Synthetic question',
    assistant_content:'Synthetic answer',created_at:stamp,links_json:links};
  const event=(event_id,kind,payload={})=>({event_id,kind,user_id:uid,payload});
  async function journal(path,data){
    const response=await stub.fetch(new Request('https://journal.internal'+path,{
      method:data?'POST':'GET',headers:{'X-BOR-Journal-Token':secret,
      ...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})
    }));
    if(response.status!==200)fail('staging_recovery_journal_request_failed');
    const result=await response.json();
    if(result.ok!==true)fail('staging_recovery_journal_invalid');
    return result;
  }
  const bind=(sql,...args)=>db.prepare(sql).bind(...args);
  const select=(sql,...args)=>bind(sql,...args).first();
  const list=(sql,...args)=>bind(sql,...args).all().then(x=>x.results);
  const batch=entries=>db.batch(entries.map(([sql,...args])=>bind(sql,...args)));
  // No IF NOT EXISTS: reused or prepopulated D1 must fail closed.
  await db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,picture TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at INTEGER NOT NULL,idempotency_key TEXT,links_json TEXT);
    CREATE UNIQUE INDEX idx_messages_user_idempotency ON messages(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE checkpoint(singleton INTEGER PRIMARY KEY CHECK(singleton=1),seq INTEGER NOT NULL);
    CREATE TABLE forced_failure(id INTEGER PRIMARY KEY);
    INSERT INTO forced_failure(id) VALUES(1);`);
  const first=await journal('/append',event('owner-1','account.created'));
  const second=await journal('/append',event('chat-2','conversation.created',{conversation_id:cid,title:'Synthetic chat'}));
  const committed=event('turn-3','turn.saved',turn);
  const third=await journal('/append',committed);
  if(first.seq!==1||second.seq!==2||third.seq!==3||third.duplicate!==false)
    fail('staging_recovery_source_commit_failed');
  const snapshot=await journal('/read?after=0&limit=10&expectedHead=3');
  if(snapshot.head!==3||snapshot.events?.length!==3||
    snapshot.events[2].payload_json!==JSON.stringify(turn))fail('staging_recovery_source_snapshot_invalid');
  await batch([
    ['INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      uid,'synthetic@example.invalid','Synthetic','',stamp,stamp],
    ['INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
      cid,uid,'Synthetic chat',stamp,stamp],
    ['INSERT INTO checkpoint(singleton,seq) VALUES(1,2)']
  ]);
  const question=['INSERT INTO messages(conversation_id,user_id,role,content,created_at,idempotency_key,links_json) VALUES(?,?,?,?,?,?,?)',
    cid,uid,'user',turn.user_content,stamp,rid,null];
  const answer=['INSERT INTO messages(conversation_id,user_id,role,content,created_at,idempotency_key,links_json) VALUES(?,?,?,?,?,?,?)',
    cid,uid,'assistant',turn.assistant_content,stamp,null,links];
  let failed=false;
  try{
    await batch([question,answer,['INSERT INTO forced_failure(id) VALUES(1)'],
      ['UPDATE checkpoint SET seq=3 WHERE singleton=1 AND seq=2']]);
  }catch{failed=true;}
  if(!failed||(await select('SELECT seq FROM checkpoint WHERE singleton=1'))?.seq!==2||
    (await select('SELECT COUNT(*) AS n FROM messages'))?.n!==0)fail('staging_recovery_rollback_failed');
  const retry=await journal('/append',committed);
  if(retry.duplicate!==true||retry.seq!==3)fail('staging_recovery_duplicate_failed');
  const after=await journal('/read?after=0&limit=10&expectedHead=3');
  if(JSON.stringify(after.events)!==JSON.stringify(snapshot.events))fail('staging_recovery_journal_changed');
  await batch([question,answer,['UPDATE checkpoint SET seq=3 WHERE singleton=1 AND seq=2']]);
  const expected=[{role:'user',content:turn.user_content,idempotency_key:rid,links_json:null,created_at:stamp},
    {role:'assistant',content:turn.assistant_content,idempotency_key:null,links_json:links,created_at:stamp}];
  const rows=await list('SELECT role,content,idempotency_key,links_json,created_at FROM messages ORDER BY id');
  if(JSON.stringify(rows)!==JSON.stringify(expected)||
    (await select('SELECT seq FROM checkpoint WHERE singleton=1'))?.seq!==3||
    (await list('PRAGMA foreign_key_check')).length!==0)
    fail('staging_recovery_replay_integrity_failed');
  // Checkpoint 3 means repeated replay is a NO-OP, not a second D1 insert.
  if((await select('SELECT seq FROM checkpoint WHERE singleton=1'))?.seq!==3||
    JSON.stringify(await list('SELECT role,content,idempotency_key,links_json,created_at FROM messages ORDER BY id'))!==
    JSON.stringify(expected))fail('staging_recovery_duplicate_replay_failed');
  return Object.freeze({passed:true,syntheticOnly:true,journalCommitted:true,
    rollbackBeforeCheckpoint:true,batchAtomic:true,retryIdempotent:true,
    restoredMessages:2,checkpoint:3,replayAgainNoOp:true,foreignKeysClean:true,
    productionD1Accessed:false,customerDataAccessed:false,productionRecoveryProven:false});
}

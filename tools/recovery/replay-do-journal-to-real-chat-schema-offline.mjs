// NONPRODUCTION / SYNTHETIC ONLY. Never binds Cloudflare or reads a user D1.
// Exercises the REAL migrations for BOR AI chat against a fresh in-memory SQLite
// database, mapping stable journal IDs to its INTEGER AUTOINCREMENT message IDs.
// This intentionally cannot recreate actual sessions, timestamps, links,
// idempotency keys, image foreign keys or a historic production checkpoint.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const MIGRATIONS=[
  '0001_auth_and_chat.sql','0004_conversation_pinning.sql',
  '0005_conversation_archive.sql','0006_chat_request_idempotency.sql',
  '0007_answer_feedback.sql','0008_message_link_sources.sql'
];
const KINDS=new Set(['account.created','conversation.created','message.saved',
  'conversation.updated','turn.replaced','feedback.set','conversation.deleted',
  'conversations.deleted_all','account.deleted']);
const CONTENT_KINDS=new Set(['conversation.created','message.saved','conversation.updated',
  'turn.replaced','feedback.set']);
const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{2,160}$/.test(x);
const fail=code=>{throw Error(code);};

export function createIsolatedActualChatSchemaOffline(){
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON');
    for(const name of MIGRATIONS){
      db.exec(readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8'));
    }
    db.exec("CREATE TABLE offline_recovery_guard(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner_id TEXT,seq INTEGER NOT NULL DEFAULT 0);"+
      "INSERT INTO offline_recovery_guard(singleton,seq) VALUES(1,0);"+
      "CREATE TABLE offline_recovery_messages(stable_message_id TEXT PRIMARY KEY,d1_message_id INTEGER NOT NULL UNIQUE,conversation_id TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);"+
      "CREATE TABLE offline_recovery_conversation_tombstones(id TEXT PRIMARY KEY);"+
      "CREATE TABLE offline_recovery_account_tombstones(id TEXT PRIMARY KEY)");
    return db;
  }catch(e){db.close();throw e;}
}

function checkedSnapshot(snapshot){
  if(!snapshot||!idOk(snapshot.userId)||!Number.isSafeInteger(snapshot.head)||
     snapshot.head<1||snapshot.head>5000||!Array.isArray(snapshot.events)||
     snapshot.events.length!==snapshot.head)fail('offline_actual_d1_snapshot_invalid');
  const ids=new Set(), events=snapshot.events;
  for(let i=0;i<events.length;i++){
    const e=events[i];
    if(!e||e.seq!==i+1||!idOk(e.event_id)||ids.has(e.event_id)||
       e.user_id!==snapshot.userId||!KINDS.has(e.kind)||
       ![0,1].includes(e.redacted)||typeof e.payload_json!=='string'||
       e.payload_json.length>22000||
       !(e.conversation_id===null||idOk(e.conversation_id)))
      fail('offline_actual_d1_source_invalid');
    ids.add(e.event_id);
    let p;
    try{p=JSON.parse(e.payload_json);}catch{fail('offline_actual_d1_source_invalid');}
    if(!p||typeof p!=='object'||Array.isArray(p))fail('offline_actual_d1_source_invalid');
    if(e.redacted===1){
      if(e.payload_json!=='{}')fail('offline_actual_d1_redaction_invalid');
      const later=events.slice(i+1);
      const account=later.some(x=>x.kind==='account.deleted'&&x.redacted===0);
      const conversation=e.conversation_id!==null&&CONTENT_KINDS.has(e.kind)&&
        later.some(x=>x.redacted===0&&(x.kind==='conversations.deleted_all'||
          (x.kind==='conversation.deleted'&&x.conversation_id===e.conversation_id)));
      if(!account&&!conversation)fail('offline_actual_d1_redaction_unverified');
    }else{
      const content=CONTENT_KINDS.has(e.kind)||e.kind==='conversation.deleted';
      if(content&&p.conversation_id!==e.conversation_id)
        fail('offline_actual_d1_conversation_mismatch');
      if(!content&&e.conversation_id!==null)
        fail('offline_actual_d1_account_mismatch');
    }
  }
  if(events[0].kind!=='account.created')fail('offline_actual_d1_account_event_missing');
  return events;
}
const one=(db,sql,...args)=>db.prepare(sql).get(...args);
const run=(db,sql,...args)=>db.prepare(sql).run(...args);
const has=(db,sql,...args)=>Boolean(one(db,sql,...args));
const owned=(db,userId,conversationId)=>{
  if(!has(db,'SELECT 1 FROM conversations WHERE id=? AND user_id=?',conversationId,userId))
    fail('offline_actual_d1_conversation_missing');
};
const mapped=(db,id,conversationId,role)=>{
  const row=one(db,'SELECT d1_message_id,conversation_id,role,active FROM offline_recovery_messages WHERE stable_message_id=?',id);
  if(!row||row.active!==1||row.conversation_id!==conversationId||row.role!==role)
    fail('offline_actual_d1_message_mapping_missing');
  return row.d1_message_id;
};
const addMessage=(db,userId,conversationId,stable,role,content,stamp)=>{
  if(!idOk(stable)||!['user','assistant'].includes(role)||typeof content!=='string'||!content.length)
    fail('offline_actual_d1_message_invalid');
  if(has(db,'SELECT 1 FROM offline_recovery_messages WHERE stable_message_id=?',stable))
    fail('offline_actual_d1_message_id_reused');
  const info=run(db,'INSERT INTO messages(conversation_id,user_id,role,content,created_at) VALUES(?,?,?,?,?)',
    conversationId,userId,role,content,stamp);
  run(db,'INSERT INTO offline_recovery_messages(stable_message_id,d1_message_id,conversation_id,role) VALUES(?,?,?,?)',
    stable,Number(info.lastInsertRowid),conversationId,role);
};
function project(db,e,user,stamp){
  const id=user.id,p=JSON.parse(e.payload_json),kind=e.kind;
  if(kind!=='account.deleted'&&has(db,'SELECT 1 FROM offline_recovery_account_tombstones WHERE id=?',id))
    fail('offline_actual_d1_account_resurrection');
  if(kind==='account.created'){
    run(db,'INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      id,user.email,user.name,user.picture,stamp,stamp);
  }else if(kind==='conversation.created'){
    if(has(db,'SELECT 1 FROM offline_recovery_conversation_tombstones WHERE id=?',p.conversation_id))
      fail('offline_actual_d1_conversation_resurrection');
    run(db,'INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
      p.conversation_id,id,p.title,stamp,stamp);
  }else if(kind==='message.saved'){
    owned(db,id,p.conversation_id);
    addMessage(db,id,p.conversation_id,p.message_id,p.role,p.content,stamp);
  }else if(kind==='conversation.updated'){
    owned(db,id,p.conversation_id);
    const updates=[],values=[];
    if(Object.hasOwn(p,'title')){updates.push('title=?');values.push(p.title);}
    if(Object.hasOwn(p,'pinned')){updates.push('pinned=?');values.push(p.pinned?1:0);}
    if(Object.hasOwn(p,'archived')){updates.push('archived=?');values.push(p.archived?1:0);}
    if(!updates.length)fail('offline_actual_d1_update_invalid');
    run(db,'UPDATE conversations SET '+updates.join(',')+',updated_at=? WHERE id=? AND user_id=?',
      ...values,stamp,p.conversation_id,id);
  }else if(kind==='feedback.set'){
    owned(db,id,p.conversation_id);
    if(!['helpful','not_helpful'].includes(p.rating)||typeof p.reason!=='string')
      fail('offline_actual_d1_feedback_invalid');
    const messageId=mapped(db,p.message_id,p.conversation_id,'assistant');
    run(db,'INSERT INTO answer_feedback(user_id,conversation_id,message_id,rating,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?) '+
      'ON CONFLICT(user_id,message_id) DO UPDATE SET rating=excluded.rating,reason=excluded.reason,updated_at=excluded.updated_at',
      id,p.conversation_id,messageId,p.rating,p.reason,stamp,stamp);
  }else if(kind==='turn.replaced'){
    owned(db,id,p.conversation_id);
    const oldUser=mapped(db,p.old_user_message_id,p.conversation_id,'user');
    const oldAssistant=mapped(db,p.old_assistant_message_id,p.conversation_id,'assistant');
    const latest=db.prepare('SELECT id,role FROM messages WHERE user_id=? AND conversation_id=? ORDER BY id DESC LIMIT 2')
      .all(id,p.conversation_id);
    if(latest.length!==2||latest[0].id!==oldAssistant||latest[0].role!=='assistant'||
       latest[1].id!==oldUser||latest[1].role!=='user')
      fail('offline_actual_d1_stale_replacement');
    if(new Set([p.old_user_message_id,p.old_assistant_message_id,
        p.new_user_message_id,p.new_assistant_message_id]).size!==4)
      fail('offline_actual_d1_replacement_id_conflict');
    run(db,'DELETE FROM messages WHERE id IN (?,?) AND user_id=? AND conversation_id=?',
      oldUser,oldAssistant,id,p.conversation_id);
    run(db,'UPDATE offline_recovery_messages SET active=0 WHERE stable_message_id IN (?,?)',
      p.old_user_message_id,p.old_assistant_message_id);
    addMessage(db,id,p.conversation_id,p.new_user_message_id,'user',p.user_content,stamp);
    addMessage(db,id,p.conversation_id,p.new_assistant_message_id,'assistant',p.assistant_content,stamp);
  }else if(kind==='conversation.deleted'){
    run(db,'INSERT OR IGNORE INTO offline_recovery_conversation_tombstones(id) VALUES(?)',p.conversation_id);
    run(db,'DELETE FROM conversations WHERE id=? AND user_id=?',p.conversation_id,id);
    run(db,'UPDATE offline_recovery_messages SET active=0 WHERE conversation_id=?',p.conversation_id);
  }else if(kind==='conversations.deleted_all'){
    const chats=db.prepare('SELECT id FROM conversations WHERE user_id=?').all(id);
    for(const c of chats)run(db,'INSERT OR IGNORE INTO offline_recovery_conversation_tombstones(id) VALUES(?)',c.id);
    run(db,'DELETE FROM conversations WHERE user_id=?',id);
    run(db,'UPDATE offline_recovery_messages SET active=0');
  }else if(kind==='account.deleted'){
    run(db,'INSERT OR IGNORE INTO offline_recovery_account_tombstones(id) VALUES(?)',id);
    run(db,'DELETE FROM users WHERE id=?',id);
    run(db,'UPDATE offline_recovery_messages SET active=0');
  }else fail('offline_actual_d1_event_unsupported');
}

export function replayVerifiedDoSnapshotIntoActualChatSchemaOffline(db,snapshot,
  {owner,syntheticTimestamp,beforeCheckpoint=()=>{},maxEvents=5000}={}){
  const events=checkedSnapshot(snapshot);
  if(!db||!owner||owner.id!==snapshot.userId||!idOk(owner.id)||
     typeof owner.email!=='string'||!owner.email.includes('@')||
     typeof owner.name!=='string'||typeof owner.picture!=='string'||
     !Number.isSafeInteger(syntheticTimestamp)||syntheticTimestamp<1||
     !Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>5000)
    fail('offline_actual_d1_preflight_invalid');
  const guard=one(db,'SELECT owner_id,seq FROM offline_recovery_guard WHERE singleton=1');
  if(!guard||guard.seq>snapshot.head||guard.owner_id&&guard.owner_id!==owner.id)
    fail('offline_actual_d1_checkpoint_or_owner_invalid');
  // This helper accepts only fresh, explicit in-memory databases initialized by
  // createIsolatedActualChatSchemaOffline(). It cannot open Cloudflare D1.
  let applied=0;
  for(const e of events.slice(guard.seq)){
    if(applied>=maxEvents)break;
    db.exec('BEGIN IMMEDIATE');
    try{
      const last=one(db,'SELECT seq FROM offline_recovery_guard WHERE singleton=1').seq;
      if(e.seq!==last+1)fail('offline_actual_d1_sequence_gap');
      if(e.redacted===0)project(db,e,owner,syntheticTimestamp);
      beforeCheckpoint(e); // inject a crash between D1 projection and cursor commit
      const result=run(db,'UPDATE offline_recovery_guard SET owner_id=?,seq=? WHERE singleton=1 AND seq=?',
        owner.id,e.seq,last);
      if(result.changes!==1)fail('offline_actual_d1_checkpoint_conflict');
      db.exec('COMMIT');
      applied++;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  const last=one(db,'SELECT seq FROM offline_recovery_guard WHERE singleton=1').seq;
  if(last!==snapshot.head)fail('offline_actual_d1_replay_incomplete');
  const count=table=>one(db,'SELECT COUNT(*) AS n FROM '+table).n;
  return Object.freeze({applied,head:last,fullyReplayed:true,
    accounts:count('users'),sessions:count('sessions'),
    conversations:count('conversations'),messages:count('messages'),
    feedback:count('answer_feedback'),
    conversationTombstones:count('offline_recovery_conversation_tombstones'),
    accountTombstones:count('offline_recovery_account_tombstones'),
    productionDatabaseTouched:false,usesActualChatCoreMigrations:true,
    originalMessageIdsPreserved:false,originalTimestampsPreserved:false,
    originalSessionsPreserved:false,originalLinksPreserved:false,
    independentStorageBackfillProven:false});
}

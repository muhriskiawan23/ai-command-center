// Offline-only staging disaster-recovery drill for the *actual* private
// SQLite Durable Object wire event format. No Cloudflare credentials, D1,
// customer content exports or production Worker writes are performed here.
// The recovered projection is synthetic and MUST NOT be used for live cutover.
import {DatabaseSync} from 'node:sqlite';
import {initSyntheticJournal,initSyntheticProjection,replaySyntheticJournal}
  from './chat-journal-prototype.mjs';

const USER=/^[A-Za-z0-9_-]{2,160}$/;
const EVENTS=new Set(['account.created','conversation.created','message.saved','turn.saved',
  'conversation.updated','turn.replaced','feedback.set','conversation.deleted',
  'conversations.deleted_all','account.deleted']);
const CONTENT_EVENTS=new Set(['conversation.created','message.saved','turn.saved','conversation.updated',
  'turn.replaced','feedback.set']);
const MAX_EVENTS=5000;
const fail=(message)=>{throw Error(message);};
const parseRow=(row,userId)=>{
  if(!row||typeof row!=='object'||!Number.isSafeInteger(row.seq)||row.seq<1||
     typeof row.event_id!=='string'||!USER.test(row.event_id)||
     row.user_id!==userId||!EVENTS.has(row.kind)||![0,1].includes(row.redacted)||
     typeof row.payload_json!=='string'||row.payload_json.length>22000||
     !(row.conversation_id===null||(typeof row.conversation_id==='string'&&USER.test(row.conversation_id))))
    fail('journal_snapshot_event_invalid');
  let p;
  try{p=JSON.parse(row.payload_json);}catch{fail('journal_snapshot_payload_invalid');}
  if(!p||typeof p!=='object'||Array.isArray(p))fail('journal_snapshot_payload_invalid');
  if(row.redacted===1&&row.payload_json!=='{}')fail('journal_snapshot_redaction_invalid');
  if(row.redacted===0){
    if(CONTENT_EVENTS.has(row.kind)||row.kind==='conversation.deleted'){
      if(p.conversation_id!==row.conversation_id)fail('journal_snapshot_conversation_mismatch');
    }else if(row.conversation_id!==null)fail('journal_snapshot_account_event_with_conversation');
  }
  return {...row};
};

// Call with a *private* already-authorized Durable Object stub. Do not expose
// this to any HTTP endpoint. The captured independent operator watermark is
// essential to detect a fully absent tail; the journal head alone cannot.
export async function collectPrivateDoSnapshot(stub,{userId,secret,expectedMinimumHead,
  pageLimit=50,maxEvents=MAX_EVENTS}={}){
  if(!USER.test(userId||'')||typeof secret!=='string'||secret.length<32||
     !Number.isSafeInteger(expectedMinimumHead)||expectedMinimumHead<0||
     !Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>100||
     !Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>MAX_EVENTS)
    fail('journal_snapshot_preflight_invalid');
  let cursor=0, head=null;
  const events=[],ids=new Set();
  while(true){
    const url=new URL('https://journal.internal/read');
    url.searchParams.set('after',String(cursor));
    url.searchParams.set('limit',String(pageLimit));
    if(head!==null)url.searchParams.set('expectedHead',String(head));
    let response;
    try{response=await stub.fetch(new Request(url,{headers:{'X-BOR-Journal-Token':secret}}));}
    catch{fail('journal_snapshot_read_failed');}
    if(response.status!==200)fail('journal_snapshot_read_failed');
    let body;
    try{body=await response.json();}catch{fail('journal_snapshot_read_invalid');}
    if(body?.ok!==true||!Number.isSafeInteger(body.head)||body.head<0||
       !Array.isArray(body.events)||body.events.length>pageLimit)
      fail('journal_snapshot_read_invalid');
    if(head===null){
      head=body.head;
      if(head<expectedMinimumHead)fail('journal_snapshot_tail_missing');
      if(head>maxEvents)fail('journal_snapshot_unbounded');
    }else if(body.head!==head)fail('journal_snapshot_head_changed');
    for(const event of body.events){
      const e=parseRow(event,userId);
      if(e.seq!==cursor+1||ids.has(e.event_id)||e.seq>head)
        fail('journal_snapshot_gap_duplicate_or_future');
      ids.add(e.event_id);
      events.push(e);
      cursor=e.seq;
    }
    if(cursor===head){
      if(body.events.length===0 && head>0)fail('journal_snapshot_incomplete');
      break;
    }
    if(body.events.length===0||events.length>=maxEvents)
      fail('journal_snapshot_incomplete');
  }
  // Validate all mutations after complete page ingestion, including source
  // payload erasure: each redaction MUST be justified by a later deletion.
  for(const e of events){
    if(e.redacted!==1)continue;
    const later=events.slice(e.seq).filter(row=>row.seq>e.seq);
    const accountDeletion=later.some(row=>row.kind==='account.deleted'&&row.redacted===0);
    const conversationDeletion=e.conversation_id!==null&&later.some(row=>
      row.redacted===0&&(row.kind==='conversations.deleted_all'||
      (row.kind==='conversation.deleted'&&row.conversation_id===e.conversation_id)));
    if(!accountDeletion && !(CONTENT_EVENTS.has(e.kind)&&conversationDeletion))
      fail('journal_snapshot_unverified_redaction');
  }
  return Object.freeze({userId,head,events:Object.freeze(events)});
}

// The adapter projects a complete verified private DO snapshot into a NEW
// ephemeral SQLite database (separate journal and projection). It refuses a
// partial dataset and never touches actual BOR AI D1 schema or messages.
export function replayDoSnapshotOffline(snapshot,{maxReplayEvents=MAX_EVENTS,beforeCheckpoint=()=>{}}={}){
  if(!snapshot||!USER.test(snapshot.userId||'')||
     !Number.isSafeInteger(snapshot.head)||snapshot.head<0||
     !Array.isArray(snapshot.events)||snapshot.events.length!==snapshot.head)
    fail('journal_snapshot_incomplete');
  // The legacy toy replayer has no atomic-turn or real integer-FK support.
  // Never silently downgrade an atomic two-message event into half a turn.
  // Use replayVerifiedDoSnapshotIntoActualChatSchemaOffline() instead.
  if(snapshot.events.some(e=>e.kind==='turn.saved'))
    fail('journal_snapshot_atomic_turn_requires_real_schema_replay');
  const journal=new DatabaseSync(':memory:');
  const projection=new DatabaseSync(':memory:');
  try{
    initSyntheticJournal(journal);
    initSyntheticProjection(projection);
    const sql=journal.prepare(
      'INSERT INTO recovery_journal(seq,event_id,user_id,kind,payload_json,version,redacted) VALUES(?,?,?,?,?,1,?)'
    );
    const events=snapshot.events;
    for(const row of events){
      const e=parseRow(row,snapshot.userId);
      // In real DO storage conversation_id survives separately from erased
      // payload_json. Adapt it to synthetic replay's privacy tombstone format.
      // After account deletion all earlier payloads MUST be empty.
      const accountDeletedLater=events.some(next=>next.seq>e.seq&&
        next.kind==='account.deleted'&&next.redacted===0);
      let payload=e.payload_json;
      if(e.redacted===1&&e.conversation_id&&CONTENT_EVENTS.has(e.kind)&&!accountDeletedLater)
        payload=JSON.stringify({conversation_id:e.conversation_id});
      if(e.redacted===0&&e.kind==='feedback.set'){
        const p=JSON.parse(payload);
        if(!['helpful','not_helpful'].includes(p.rating))
          fail('journal_snapshot_feedback_invalid');
        payload=JSON.stringify({...p,rating:p.rating==='helpful'?'up':'down'});
      }
      sql.run(e.seq,e.event_id,e.user_id,e.kind,payload,e.redacted);
    }
    const result=replaySyntheticJournal(journal,projection,{
      expectedHeadSeq:snapshot.head,maxEvents:maxReplayEvents,beforeCheckpoint
    });
    const count=table=>projection.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
    return Object.freeze({...result,fullyReplayed:result.lastSeq===snapshot.head,
      accounts:count('recovered_accounts'),
      conversations:count('recovered_conversations'),
      messages:count('recovered_messages'),
      feedback:count('recovered_feedback'),
      conversationTombstones:count('recovered_conversation_tombstones'),
      accountTombstones:count('recovered_account_tombstones'),
      // No customer text, prompts or URL data in diagnostic result.
      readOnly:true,productionDatabaseTouched:false});
  }finally{projection.close();journal.close();}
}

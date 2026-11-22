// Independent SQLite-backed Durable Object event journal. NOT wired to live chat.
// A successful append commits to storage separate from primary D1. Do not
// enable or claim zero loss until ALL mutation paths, backfill and replay pass
// a separately reviewed production disaster drill.
const ID = /^[A-Za-z0-9_-]{2,160}$/;
const isId = value => typeof value === 'string' && ID.test(value);
const CHAT_EVENTS = new Set([
  'conversation.created', 'message.saved', 'conversation.updated',
  'turn.replaced', 'feedback.set'
]);
const DELETIONS = new Set(['conversation.deleted', 'conversations.deleted_all', 'account.deleted']);
const KINDS = new Set(['account.created', ...CHAT_EVENTS, ...DELETIONS]);
const MAX_EVENT_BYTES = 22000;
const respond = (data,status=200) => new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const err = (code,status=409) => respond({ok:false,code},status);
const safeEqual = (a,b) => {
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
};
const validText = (value,length=16000) => typeof value==='string' && value.length>0 && value.length<=length;
// The private interface still must not buffer unbounded caller-controlled bytes.
async function readBoundedEventBody(request){
  const limit=MAX_EVENT_BYTES+1200;
  const claimed=request.headers.get('Content-Length');
  if(claimed && Number(claimed)>limit)throw Error('invalid_event');
  if(!request.body)return '';
  const reader=request.body.getReader();
  let total=0;
  const chunks=[];
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>limit)throw Error('invalid_event');
      chunks.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  const buffer=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
  catch{throw Error('invalid_event');}
}

const shape = (p,keys,optional=[]) => Object.keys(p).every(key=>keys.includes(key)||optional.includes(key)) &&
  keys.every(key=>Object.hasOwn(p,key));
function validateEvent(event){
  if(!event||typeof event!=='object'||Array.isArray(event)||
    !isId(event.event_id)||!isId(event.user_id)||!KINDS.has(event.kind)||
    !event.payload||typeof event.payload!=='object'||Array.isArray(event.payload))
    throw Error('invalid_event');
  const p=event.payload,k=event.kind;
  if(k==='account.created'||k==='account.deleted'||k==='conversations.deleted_all') {
    if(Object.keys(p).length)throw Error('invalid_event');
  }else if(k==='conversation.created'){
    if(!shape(p,['conversation_id','title'])||!isId(p.conversation_id)||!validText(p.title,180))
      throw Error('invalid_event');
  }else if(k==='message.saved'){
    if(!shape(p,['conversation_id','message_id','role','content'])||!isId(p.conversation_id)||
      !isId(p.message_id)||!['user','assistant'].includes(p.role)||!validText(p.content))
      throw Error('invalid_event');
  }else if(k==='conversation.updated'){
    if(!shape(p,['conversation_id'],['title','pinned','archived'])||!isId(p.conversation_id)||
      Object.keys(p).length<2||
      (Object.hasOwn(p,'title')&&!validText(p.title,180))||
      (Object.hasOwn(p,'pinned')&&typeof p.pinned!=='boolean')||
      (Object.hasOwn(p,'archived')&&typeof p.archived!=='boolean'))
      throw Error('invalid_event');
  }else if(k==='turn.replaced'){
    if(!shape(p,['conversation_id','old_user_message_id','old_assistant_message_id',
      'new_user_message_id','new_assistant_message_id','user_content','assistant_content'])||
      !isId(p.conversation_id)||!['old_user_message_id','old_assistant_message_id',
        'new_user_message_id','new_assistant_message_id'].every(key=>isId(p[key]))||
      !validText(p.user_content)||!validText(p.assistant_content))
      throw Error('invalid_event');
  }else if(k==='feedback.set'){
    if(!shape(p,['conversation_id','message_id','rating','reason'])||
      !isId(p.conversation_id)||!isId(p.message_id)||
      !['helpful','not_helpful'].includes(p.rating)||
      typeof p.reason!=='string'||p.reason.length>500)
      throw Error('invalid_event');
  }else if(k==='conversation.deleted'){
    if(!shape(p,['conversation_id'])||!isId(p.conversation_id))throw Error('invalid_event');
  }
  // Shallow allowlist of primitive fields: stable across property order and
  // rejects accidentally uploading entire browser histories and API secrets.
  const canonical=Object.fromEntries(Object.keys(p).sort().map(key=>[key,p[key]]));
  const payload_json=JSON.stringify(canonical);
  if(payload_json.length>MAX_EVENT_BYTES)throw Error('invalid_event');
  return {event_id:event.event_id,user_id:event.user_id,kind:k,
    conversation_id:typeof p.conversation_id==='string'?p.conversation_id:null,payload_json};
}
function init(storage){
  const sql=storage?.sql;
  if(!sql||typeof storage.transactionSync!=='function')throw Error('sqlite_storage_required');
  sql.exec('CREATE TABLE IF NOT EXISTS journal_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1),user_id TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)))');
  sql.exec('CREATE TABLE IF NOT EXISTS journal_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,kind TEXT NOT NULL,conversation_id TEXT,payload_json TEXT NOT NULL,redacted INTEGER NOT NULL DEFAULT 0 CHECK(redacted IN (0,1)))');
  sql.exec('CREATE INDEX IF NOT EXISTS journal_events_conversation ON journal_events(conversation_id,seq)');
  sql.exec('CREATE TABLE IF NOT EXISTS conversation_tombstones (conversation_id TEXT PRIMARY KEY)');
}
const first=(sql,query,...args)=>sql.exec(query,...args).toArray()[0]||null;
const list=(sql,query,...args)=>sql.exec(query,...args).toArray();
function append(storage,event){
  const sql=storage.sql;
  return storage.transactionSync(()=>{
    let owner=first(sql,'SELECT user_id,deleted FROM journal_owner WHERE singleton=1');
    if(!owner){
      if(event.kind!=='account.created')throw Error('account_not_initialized');
      sql.exec('INSERT INTO journal_owner(singleton,user_id,deleted) VALUES(1,?,0)',event.user_id);
      owner={user_id:event.user_id,deleted:0};
    }
    if(owner.user_id!==event.user_id)throw Error('owner_mismatch');
    if(owner.deleted)throw Error('deleted_account');
    const existing=first(sql,'SELECT seq,kind,payload_json,redacted,conversation_id FROM journal_events WHERE event_id=?',event.event_id);
    if(existing){
      if(existing.redacted)throw Error('deleted_event');
      if(existing.kind!==event.kind||existing.payload_json!==event.payload_json||
        existing.conversation_id!==event.conversation_id)throw Error('event_id_conflict');
      return {seq:existing.seq,duplicate:true};
    }
    if(event.conversation_id){
      const tombstone=first(sql,'SELECT 1 AS found FROM conversation_tombstones WHERE conversation_id=?',event.conversation_id);
      if(tombstone)throw Error('deleted_conversation');
      const created=first(sql,"SELECT seq FROM journal_events WHERE kind='conversation.created' AND conversation_id=? LIMIT 1",event.conversation_id);
      if(event.kind==='conversation.created'){
        if(created)throw Error('conversation_id_reused');
      }else if(!created)throw Error('conversation_missing');
    }
    sql.exec(
      'INSERT INTO journal_events(event_id,user_id,kind,conversation_id,payload_json) VALUES(?,?,?,?,?)',
      event.event_id,event.user_id,event.kind,event.conversation_id,event.payload_json
    );
    const inserted=first(sql,'SELECT seq FROM journal_events WHERE event_id=?',event.event_id);
    if(!inserted)throw Error('journal_write_not_verified');
    if(event.kind==='conversation.deleted'){
      // Scrub the actual source payload in the same commit as its tombstone.
      sql.exec('INSERT INTO conversation_tombstones(conversation_id) VALUES(?)',event.conversation_id);
      sql.exec("UPDATE journal_events SET payload_json='{}',redacted=1 WHERE conversation_id=? AND seq<? AND kind NOT IN ('conversation.deleted')",
        event.conversation_id,inserted.seq);
    }else if(event.kind==='conversations.deleted_all'){
      sql.exec("INSERT OR IGNORE INTO conversation_tombstones(conversation_id) SELECT DISTINCT conversation_id FROM journal_events WHERE kind='conversation.created' AND conversation_id IS NOT NULL");
      sql.exec("UPDATE journal_events SET payload_json='{}',redacted=1 WHERE seq<? AND conversation_id IS NOT NULL",
        inserted.seq);
    }else if(event.kind==='account.deleted'){
      sql.exec("UPDATE journal_events SET payload_json='{}',redacted=1 WHERE seq<?",inserted.seq);
      sql.exec('UPDATE journal_owner SET deleted=1 WHERE singleton=1');
    }
    return {seq:inserted.seq,duplicate:false};
  });
}
// Only the Worker with both a Durable Object binding AND the separate secret
// can call this internal API. No public fetch route to this class is exported.
export class ChatJournalDurableObject {
  constructor(ctx,env){this.ctx=ctx;this.env=env;init(ctx.storage);}
  async fetch(request){
    const token=this.env.CHAT_JOURNAL_INTERNAL_SECRET;
    if(typeof token!=='string'||token.length<32||
      !safeEqual(token,request.headers.get('X-BOR-Journal-Token')))
      return err('journal_unauthorized',401);
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/append'){
      let raw;
      try{raw=await readBoundedEventBody(request);}
      catch{return err('invalid_event',400);}
      try{
        let payload;
        try{payload=JSON.parse(raw);}catch{throw Error('invalid_event');}
        const event=validateEvent(payload);
        const result=append(this.ctx.storage,event);
        return respond({ok:true,...result});
      }catch(error){
        const known=['invalid_event','account_not_initialized','owner_mismatch','deleted_account',
          'deleted_event','event_id_conflict','deleted_conversation','conversation_id_reused','conversation_missing'];
        return err(known.includes(error?.message)?error.message:'journal_storage_unavailable',
          !known.includes(error?.message)?503:error?.message==='invalid_event'?400:error?.message==='owner_mismatch'?403:409);
      }
    }
    if(request.method==='GET'&&url.pathname==='/read'){
      // Recovery operator path remains private: no public Worker forwarding.
      const from=Number(url.searchParams.get('after')||'0');
      const limit=Number(url.searchParams.get('limit')||'50');
      const expectedRaw=url.searchParams.get('expectedHead');
      const expectedHead=expectedRaw===null?null:Number(expectedRaw);
      if(!Number.isSafeInteger(from)||from<0||!Number.isSafeInteger(limit)||limit<1||limit>100||
        (expectedHead!==null&&(!Number.isSafeInteger(expectedHead)||expectedHead<0)))
        return err('invalid_cursor',400);
      try{
        const sql=this.ctx.storage.sql;
        const head=first(sql,'SELECT seq FROM journal_events ORDER BY seq DESC LIMIT 1')?.seq||0;
        // Reject paging across a concurrent journal append, including erasure
        // of previous payloads by deletion. No mixed-version recovery snapshot.
        if(expectedHead!==null&&head!==expectedHead)
          return err('journal_head_changed',409);
        if(from>head)return err('journal_cursor_ahead_of_head',409);
        const events=list(sql,
          'SELECT seq,event_id,user_id,kind,conversation_id,payload_json,redacted FROM journal_events WHERE seq>? ORDER BY seq LIMIT ?',
          from,limit);
        return respond({ok:true,head,events});
      }catch{return err('journal_read_unavailable',503);}
    }
    return err('journal_route_not_found',404);
  }
}

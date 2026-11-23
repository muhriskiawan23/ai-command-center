// Independent SQLite-backed Durable Object event journal. NOT wired to live chat.
// A successful append commits to storage separate from primary D1. Do not
// enable or claim zero loss until ALL mutation paths, backfill and replay pass
// a separately reviewed production disaster drill.
const ID = /^[A-Za-z0-9_-]{2,160}$/;
const isId = value => typeof value === 'string' && ID.test(value);
const CHAT_EVENTS = new Set([
  'conversation.created', 'message.saved', 'turn.saved', 'conversation.updated',
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
  }else if(k==='turn.saved'){
    // A complete user+assistant pair must be journaled as ONE durable event,
    // before any D1 mutation. Never persist a half-turn or a raw API token.
    const fields=['conversation_id','user_message_id','assistant_message_id',
      'user_content','assistant_content','request_id','created_at','links_json'];
    if(!shape(p,fields)||!isId(p.conversation_id)||!isId(p.user_message_id)||
      !isId(p.assistant_message_id)||p.user_message_id===p.assistant_message_id||
      !isId(p.request_id)||!validText(p.user_content,8000)||
      !validText(p.assistant_content,8000)||
      !Number.isSafeInteger(p.created_at)||p.created_at<1||
      !(p.links_json===null||(typeof p.links_json==='string'&&p.links_json.length<=4096)))
      throw Error('invalid_event');
    if(p.links_json!==null){
      let links;
      try{links=JSON.parse(p.links_json);}catch{throw Error('invalid_event');}
      if(!Array.isArray(links)||links.length>8||
        links.some(link=>!link||typeof link!=='object'||Array.isArray(link)||
          !Object.keys(link).every(key=>['url','title'].includes(key))||
          typeof link.url!=='string'||link.url.length>2048||
          !/^https:\/\//i.test(link.url)||
          typeof link.title!=='string'||link.title.length>180))
        throw Error('invalid_event');
    }
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
      new Set(['old_user_message_id','old_assistant_message_id',
        'new_user_message_id','new_assistant_message_id'].map(key=>p[key])).size!==4||
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
  // Per-owner relational admission index: journal events are NOT durable/replayable
  // merely because their JSON shape is valid. Track actual live message IDs,
  // roles and latest turn order in the same SQLite transaction as event append.
  // Never let retries reissue a payment/model call or create duplicate IDs.
  sql.exec("CREATE TABLE IF NOT EXISTS journal_message_ids (message_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('user','assistant')),seq INTEGER NOT NULL,ordinal INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)))");
  sql.exec('CREATE INDEX IF NOT EXISTS journal_live_message_order ON journal_message_ids(conversation_id,active,seq DESC,ordinal DESC)');
  // Cross-event request deduplication is independent of event_id. The request
  // is opaque, non-secret, per-owner, and never copied from an unverified browser.
  sql.exec('CREATE TABLE IF NOT EXISTS journal_turn_requests(request_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,seq INTEGER NOT NULL)');
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
    const existing=first(sql,'SELECT seq,kind,payload_json,redacted,conversation_id FROM journal_events WHERE event_id=?',event.event_id);
    if(existing){
      // Account erasure is a durable idempotent command: a lost 200 response
      // must be safely retryable without allowing any pre-erasure content to
      // return. All earlier events are redacted by the account tombstone.
      if(owner.deleted&&existing.kind!=='account.deleted')throw Error('deleted_account');
      if(existing.redacted)throw Error('deleted_event');
      if(existing.kind!==event.kind||existing.payload_json!==event.payload_json||
        existing.conversation_id!==event.conversation_id)throw Error('event_id_conflict');
      return {seq:existing.seq,duplicate:true};
    }
    if(owner.deleted)throw Error('deleted_account');
    if(event.conversation_id){
      const tombstone=first(sql,'SELECT 1 AS found FROM conversation_tombstones WHERE conversation_id=?',event.conversation_id);
      if(tombstone)throw Error('deleted_conversation');
      const created=first(sql,"SELECT seq FROM journal_events WHERE kind='conversation.created' AND conversation_id=? LIMIT 1",event.conversation_id);
      if(event.kind==='conversation.created'){
        if(created)throw Error('conversation_id_reused');
      }else if(!created)throw Error('conversation_missing');
    }
    // Validate references and D1-compatible message lifetimes before admitting
    // an acknowledged event. Mutations after this point are atomic with it.
    const p=JSON.parse(event.payload_json);
    if(event.kind==='message.saved'){
      if(first(sql,'SELECT 1 AS found FROM journal_message_ids WHERE message_id=?',p.message_id))
        throw Error('journal_message_id_reused');
    }else if(event.kind==='turn.saved'){
      if(first(sql,'SELECT 1 AS found FROM journal_turn_requests WHERE request_id=?',p.request_id))
        throw Error('journal_request_id_reused');
      if(first(sql,'SELECT 1 AS found FROM journal_message_ids WHERE message_id IN (?,?) LIMIT 1',
        p.user_message_id,p.assistant_message_id))
        throw Error('journal_message_id_reused');
    }else if(event.kind==='feedback.set'){
      const target=first(sql,'SELECT conversation_id,role FROM journal_message_ids WHERE message_id=? AND active=1',p.message_id);
      if(!target||target.conversation_id!==p.conversation_id||target.role!=='assistant')
        throw Error('journal_feedback_target_invalid');
    }else if(event.kind==='turn.replaced'){
      const latest=list(sql,'SELECT message_id,role FROM journal_message_ids WHERE conversation_id=? AND active=1 ORDER BY seq DESC,ordinal DESC LIMIT 2',p.conversation_id);
      if(latest.length!==2||latest[0].role!=='assistant'||latest[1].role!=='user'||
         latest[0].message_id!==p.old_assistant_message_id||
         latest[1].message_id!==p.old_user_message_id)
        throw Error('journal_stale_turn_replacement');
      if(first(sql,'SELECT 1 AS found FROM journal_message_ids WHERE message_id IN (?,?) LIMIT 1',
        p.new_user_message_id,p.new_assistant_message_id))
        throw Error('journal_message_id_reused');
    }
    sql.exec(
      'INSERT INTO journal_events(event_id,user_id,kind,conversation_id,payload_json) VALUES(?,?,?,?,?)',
      event.event_id,event.user_id,event.kind,event.conversation_id,event.payload_json
    );
    const inserted=first(sql,'SELECT seq FROM journal_events WHERE event_id=?',event.event_id);
    if(!inserted)throw Error('journal_write_not_verified');
    if(event.kind==='message.saved'){
      sql.exec('INSERT INTO journal_message_ids(message_id,conversation_id,role,seq,ordinal) VALUES(?,?,?,?,0)',
        p.message_id,p.conversation_id,p.role,inserted.seq);
    }else if(event.kind==='turn.saved'){
      sql.exec('INSERT INTO journal_message_ids(message_id,conversation_id,role,seq,ordinal) VALUES(?,?,?,?,0)',
        p.user_message_id,p.conversation_id,'user',inserted.seq);
      sql.exec('INSERT INTO journal_message_ids(message_id,conversation_id,role,seq,ordinal) VALUES(?,?,?,?,1)',
        p.assistant_message_id,p.conversation_id,'assistant',inserted.seq);
      sql.exec('INSERT INTO journal_turn_requests(request_id,conversation_id,seq) VALUES(?,?,?)',
        p.request_id,p.conversation_id,inserted.seq);
    }else if(event.kind==='turn.replaced'){
      sql.exec('UPDATE journal_message_ids SET active=0 WHERE message_id IN (?,?) AND active=1',
        p.old_user_message_id,p.old_assistant_message_id);
      sql.exec('INSERT INTO journal_message_ids(message_id,conversation_id,role,seq,ordinal) VALUES(?,?,?,?,0)',
        p.new_user_message_id,p.conversation_id,'user',inserted.seq);
      sql.exec('INSERT INTO journal_message_ids(message_id,conversation_id,role,seq,ordinal) VALUES(?,?,?,?,1)',
        p.new_assistant_message_id,p.conversation_id,'assistant',inserted.seq);
    }
    if(event.kind==='conversation.deleted'){
      sql.exec('UPDATE journal_message_ids SET active=0 WHERE conversation_id=?',event.conversation_id);
      // Scrub the actual source payload in the same commit as its tombstone.
      sql.exec('INSERT INTO conversation_tombstones(conversation_id) VALUES(?)',event.conversation_id);
      sql.exec("UPDATE journal_events SET payload_json='{}',redacted=1 WHERE conversation_id=? AND seq<? AND kind NOT IN ('conversation.deleted')",
        event.conversation_id,inserted.seq);
    }else if(event.kind==='conversations.deleted_all'){
      sql.exec('UPDATE journal_message_ids SET active=0 WHERE active=1');
      sql.exec("INSERT OR IGNORE INTO conversation_tombstones(conversation_id) SELECT DISTINCT conversation_id FROM journal_events WHERE kind='conversation.created' AND conversation_id IS NOT NULL");
      // A prior conversation.deleted event already has only the stable ID:
      // keep its tombstone payload so offline replay can prove deletion order.
      // Redact titles, prompts, assistant text, edits and feedback instead.
      sql.exec("UPDATE journal_events SET payload_json='{}',redacted=1 WHERE seq<? AND conversation_id IS NOT NULL AND kind!='conversation.deleted'",
        inserted.seq);
    }else if(event.kind==='account.deleted'){
      // An irrevocably deleted account cannot issue more events. Preserve
      // only the ordered redacted rows + final account-deleted receipt for
      // recovery; remove lookup metadata that would otherwise identify old
      // conversations, messages and request IDs after erasure.
      // Randomized opaque event IDs replace caller-provided event IDs, which
      // may themselves encode a conversation or message identifier. The
      // account.deleted event ID stays stable for idempotent ACK retries.
      // Every mutation is in this SAME Durable Object SQLite transaction.
      sql.exec("UPDATE journal_events SET payload_json='{}',redacted=1,conversation_id=NULL,event_id=lower(hex(randomblob(32))) WHERE seq<?",inserted.seq);
      sql.exec('DELETE FROM journal_message_ids');
      sql.exec('DELETE FROM journal_turn_requests');
      sql.exec('DELETE FROM conversation_tombstones');
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
          'deleted_event','event_id_conflict','deleted_conversation','conversation_id_reused','conversation_missing',
          'journal_message_id_reused','journal_request_id_reused',
          'journal_feedback_target_invalid','journal_stale_turn_replacement'];
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

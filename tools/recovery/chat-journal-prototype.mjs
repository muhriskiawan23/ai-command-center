// Synthetic/offline design proof only. Never imported by the production Worker.
// The journal and projection MUST use distinct SQLite databases in the tests.
// No production data, Cloudflare connections, or user-content telemetry.
const KINDS = new Set([
  'account.created', 'conversation.created', 'message.saved',
  'conversation.renamed', 'conversation.updated', 'turn.replaced',
  'conversations.deleted_all', 'feedback.set', 'conversation.deleted', 'account.deleted'
]);
const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{2,100}$/.test(x);
const textValue = (x, max = 16000) => typeof x === 'string' && x.length > 0 && x.length <= max;
const requireValid = yes => { if (!yes) throw Error('invalid_journal_event'); };

export function initSyntheticJournal(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS recovery_journal(' +
    'seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,' +
    'user_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,' +
    'version INTEGER NOT NULL CHECK(version=1),' +
    'redacted INTEGER NOT NULL DEFAULT 0 CHECK(redacted IN (0,1)));' +
    'CREATE INDEX IF NOT EXISTS recovery_journal_user_seq ON recovery_journal(user_id,seq);'
  );
}

export function initSyntheticProjection(db) {
  db.exec(
    'PRAGMA foreign_keys=ON;' +
    'CREATE TABLE IF NOT EXISTS recovery_checkpoint(' +
    'singleton INTEGER PRIMARY KEY CHECK(singleton=1),seq INTEGER NOT NULL);' +
    'INSERT OR IGNORE INTO recovery_checkpoint(singleton,seq) VALUES(1,0);' +
    'CREATE TABLE IF NOT EXISTS recovered_accounts(user_id TEXT PRIMARY KEY);' +
    'CREATE TABLE IF NOT EXISTS recovered_account_tombstones(user_id TEXT PRIMARY KEY);' +
    'CREATE TABLE IF NOT EXISTS recovered_conversation_tombstones(' +
    'user_id TEXT NOT NULL,conversation_id TEXT NOT NULL,PRIMARY KEY(user_id,conversation_id));' +
    'CREATE TABLE IF NOT EXISTS recovered_conversations(' +
    'conversation_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES recovered_accounts(user_id) ON DELETE CASCADE,' +
    'title TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),' +
    'archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)));' +
    'CREATE TABLE IF NOT EXISTS recovered_messages(' +
    'message_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES recovered_conversations(conversation_id) ON DELETE CASCADE,' +
    'user_id TEXT NOT NULL REFERENCES recovered_accounts(user_id) ON DELETE CASCADE,' +
    "role TEXT NOT NULL CHECK(role IN ('user','assistant'))," +
    'content TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS recovered_feedback(' +
    'message_id TEXT PRIMARY KEY REFERENCES recovered_messages(message_id) ON DELETE CASCADE,' +
    'rating TEXT NOT NULL CHECK(rating IN (\'up\',\'down\')),' +
    'reason TEXT NOT NULL DEFAULT \'\');'
  );
}

// Fail-closed domain validation. Offline proof; caller authentication is NOT implemented.
function validate(input) {
  requireValid(input && typeof input === 'object' && !Array.isArray(input));
  const {event_id, user_id, kind, payload} = input;
  requireValid(validId(event_id) && validId(user_id) && KINDS.has(kind));
  requireValid(payload && typeof payload === 'object' && !Array.isArray(payload));
  const allowed = {
    'account.created':[], 'account.deleted':[],
    'conversation.created':['conversation_id','title'],
    'message.saved':['conversation_id','message_id','role','content'],
    'conversation.renamed':['conversation_id','title'],
    'conversation.updated':['conversation_id','title','pinned','archived'],
    'turn.replaced':['conversation_id','old_user_message_id','old_assistant_message_id',
      'new_user_message_id','new_assistant_message_id','user_content','assistant_content'],
    'feedback.set':['conversation_id','message_id','rating','reason'],
    'conversations.deleted_all':[],
    'conversation.deleted':['conversation_id']
  }[kind];
  const keys=Object.keys(payload);
  requireValid(keys.every(k=>allowed.includes(k)));
  if(kind==='conversation.updated') {
    requireValid(validId(payload.conversation_id));
    requireValid(keys.some(k=>k!=='conversation_id'));
    if(keys.includes('title'))requireValid(textValue(payload.title,180));
    if(keys.includes('pinned'))requireValid(typeof payload.pinned==='boolean');
    if(keys.includes('archived'))requireValid(typeof payload.archived==='boolean');
  } else if(kind==='conversation.created'||kind==='conversation.renamed') {
    requireValid(keys.length===2&&validId(payload.conversation_id)&&textValue(payload.title,180));
  } else if(kind==='message.saved') {
    requireValid(keys.length===4&&validId(payload.conversation_id)&&validId(payload.message_id));
    requireValid(['user','assistant'].includes(payload.role)&&textValue(payload.content));
  } else if(kind==='turn.replaced') {
    requireValid(keys.length===7&&validId(payload.conversation_id));
    const ids=['old_user_message_id','old_assistant_message_id',
      'new_user_message_id','new_assistant_message_id'].map(k=>payload[k]);
    requireValid(ids.every(validId)&&new Set(ids).size===4);
    requireValid(textValue(payload.user_content)&&textValue(payload.assistant_content));
  } else if(kind==='feedback.set') {
    requireValid(keys.length===4&&validId(payload.conversation_id)&&validId(payload.message_id));
    requireValid(['up','down'].includes(payload.rating)&&typeof payload.reason==='string'&&payload.reason.length<=800);
  } else if(kind==='conversation.deleted') {
    requireValid(keys.length===1&&validId(payload.conversation_id));
  } else {
    requireValid(keys.length===0);
  }
  // Sort shallow payload keys to make duplicate requests independent of JSON key order.
  const canonical=Object.fromEntries(keys.sort().map(key=>[key,payload[key]]));
  return {event_id,user_id,kind,payload_json:JSON.stringify(canonical)};
}

export function appendSyntheticEvent(db, input) {
  const e = validate(input);
  const deleted=db.prepare(
    "SELECT event_id FROM recovery_journal WHERE user_id=? AND kind='account.deleted' LIMIT 1"
  ).get(e.user_id);
  // Once deleted, even retries of historical payloads must not repopulate data.
  if(deleted && (e.kind!=='account.deleted'||deleted.event_id!==e.event_id))
    throw Error('deleted_account_event');
  const existing=db.prepare(
    'SELECT seq,user_id,kind,payload_json FROM recovery_journal WHERE event_id=?'
  ).get(e.event_id);
  if(existing) {
    if(existing.user_id!==e.user_id||existing.kind!==e.kind||
       existing.payload_json!==e.payload_json)throw Error('event_id_conflict');
    return {seq:existing.seq,duplicate:true};
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const inserted=db.prepare(
      'INSERT INTO recovery_journal(event_id,user_id,kind,payload_json,version) VALUES(?,?,?,?,1)'
    ).run(e.event_id,e.user_id,e.kind,e.payload_json);
    const seq=Number(inserted.lastInsertRowid);
    if(e.kind==='account.deleted') {
      // Synthetic privacy rule: erase earlier payloads atomically with the tombstone.
      // Sequence and event kind remain to prevent older events from being replayed.
      db.prepare(
        "UPDATE recovery_journal SET payload_json='{}',redacted=1 " +
        "WHERE user_id=? AND seq<? AND kind!='account.deleted'"
      ).run(e.user_id,seq);
    }
    db.exec('COMMIT');
    return {seq,duplicate:false};
  } catch(error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const requireOwnedConversation = (db, userId, conversationId) => {
  const row = db.prepare(
    'SELECT user_id FROM recovered_conversations WHERE conversation_id=?'
  ).get(conversationId);
  if (!row || row.user_id!==userId) throw Error('journal_conversation_ownership_mismatch');
};
function project(db, e) {
  const p = JSON.parse(e.payload_json);
  if (e.kind!=='account.deleted' && db.prepare(
    'SELECT 1 AS found FROM recovered_account_tombstones WHERE user_id=?'
  ).get(e.user_id)) throw Error('journal_account_resurrection');

  if (e.kind==='account.created') {
    db.prepare('INSERT OR IGNORE INTO recovered_accounts(user_id) VALUES(?)').run(e.user_id);
  } else if (e.kind==='conversation.created') {
    if (db.prepare('SELECT 1 AS found FROM recovered_conversation_tombstones WHERE user_id=? AND conversation_id=?')
      .get(e.user_id,p.conversation_id)) throw Error('journal_conversation_resurrection');
    db.prepare('INSERT INTO recovered_conversations(conversation_id,user_id,title) VALUES(?,?,?)')
      .run(p.conversation_id,e.user_id,p.title);
  } else if (e.kind==='message.saved') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    db.prepare('INSERT INTO recovered_messages(message_id,conversation_id,user_id,role,content) VALUES(?,?,?,?,?)')
      .run(p.message_id,p.conversation_id,e.user_id,p.role,p.content);
  } else if (e.kind==='turn.replaced') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    // BOR AI's replaceLastTurn only replaces the most recent user/assistant pair.
    const latest=db.prepare(
      'SELECT message_id,role FROM recovered_messages WHERE conversation_id=? AND user_id=? ORDER BY rowid DESC LIMIT 2'
    ).all(p.conversation_id,e.user_id);
    if(latest.length!==2||latest[0].role!=='assistant'||latest[1].role!=='user'||
       latest[0].message_id!==p.old_assistant_message_id||
       latest[1].message_id!==p.old_user_message_id) throw Error('journal_stale_turn_replacement');
    db.prepare(
      'DELETE FROM recovered_messages WHERE message_id IN (?,?) AND user_id=? AND conversation_id=?'
    ).run(p.old_user_message_id,p.old_assistant_message_id,e.user_id,p.conversation_id);
    db.prepare(
      "INSERT INTO recovered_messages(message_id,conversation_id,user_id,role,content) VALUES(?,?,?,'user',?)"
    ).run(p.new_user_message_id,p.conversation_id,e.user_id,p.user_content);
    db.prepare(
      "INSERT INTO recovered_messages(message_id,conversation_id,user_id,role,content) VALUES(?,?,?,'assistant',?)"
    ).run(p.new_assistant_message_id,p.conversation_id,e.user_id,p.assistant_content);
  } else if (e.kind==='conversation.renamed') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    db.prepare('UPDATE recovered_conversations SET title=? WHERE conversation_id=? AND user_id=?')
      .run(p.title,p.conversation_id,e.user_id);
  } else if (e.kind==='conversation.updated') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    const fields=[], values=[];
    if(Object.hasOwn(p,'title')){fields.push('title=?');values.push(p.title);}
    if(Object.hasOwn(p,'pinned')){fields.push('pinned=?');values.push(p.pinned?1:0);}
    if(Object.hasOwn(p,'archived')){fields.push('archived=?');values.push(p.archived?1:0);}
    db.prepare('UPDATE recovered_conversations SET '+fields.join(',')+
      ' WHERE conversation_id=? AND user_id=?').run(...values,p.conversation_id,e.user_id);
  } else if (e.kind==='feedback.set') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    const message=db.prepare(
      'SELECT role,user_id,conversation_id FROM recovered_messages WHERE message_id=?'
    ).get(p.message_id);
    if(!message||message.role!=='assistant'||message.user_id!==e.user_id||
       message.conversation_id!==p.conversation_id) throw Error('journal_feedback_ownership_mismatch');
    db.prepare(
      'INSERT INTO recovered_feedback(message_id,rating,reason) VALUES(?,?,?) '+
      'ON CONFLICT(message_id) DO UPDATE SET rating=excluded.rating,reason=excluded.reason'
    ).run(p.message_id,p.rating,p.reason);
  } else if (e.kind==='conversation.deleted') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    db.prepare('INSERT INTO recovered_conversation_tombstones(user_id,conversation_id) VALUES(?,?)')
      .run(e.user_id,p.conversation_id);
    db.prepare('DELETE FROM recovered_conversations WHERE conversation_id=? AND user_id=?')
      .run(p.conversation_id,e.user_id);
  } else if (e.kind==='conversations.deleted_all') {
    const owned=db.prepare(
      'SELECT conversation_id FROM recovered_conversations WHERE user_id=?'
    ).all(e.user_id);
    for(const row of owned) {
      db.prepare('INSERT OR IGNORE INTO recovered_conversation_tombstones(user_id,conversation_id) VALUES(?,?)')
        .run(e.user_id,row.conversation_id);
    }
    db.prepare('DELETE FROM recovered_conversations WHERE user_id=?').run(e.user_id);
  } else if (e.kind==='account.deleted') {
    db.prepare('INSERT INTO recovered_account_tombstones(user_id) VALUES(?)').run(e.user_id);
    db.prepare('DELETE FROM recovered_accounts WHERE user_id=?').run(e.user_id);
  } else throw Error('unsupported_journal_event');
}

// Single-threaded offline proof. Production will need authentication, concurrency,
// lifecycle, cross-storage acknowledgment and event-stream integrity protections.
export function replaySyntheticJournal(journal, projection, {maxEvents=500, beforeCheckpoint=()=>{}}={}) {
  if (!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>10000) throw Error('invalid_replay_limit');
  let applied=0;
  while (applied<maxEvents) {
    const last=projection.prepare('SELECT seq FROM recovery_checkpoint WHERE singleton=1').get()?.seq;
    if (!Number.isSafeInteger(last)||last<0) throw Error('journal_checkpoint_invalid');
    const e=journal.prepare(
      'SELECT seq,event_id,user_id,kind,payload_json,version,redacted FROM recovery_journal WHERE seq>? ORDER BY seq LIMIT 1'
    ).get(last);
    if (!e) break;
    if (e.seq!==last+1 || e.version!==1) throw Error('journal_sequence_gap_or_version');
    projection.exec('BEGIN IMMEDIATE');
    try {
      if(e.redacted===1) {
        // Fail closed unless a later account-deletion tombstone explains this redaction.
        const tombstone=journal.prepare(
          "SELECT seq FROM recovery_journal WHERE user_id=? AND kind='account.deleted' AND seq>? LIMIT 1"
        ).get(e.user_id,e.seq);
        if(!tombstone)throw Error('journal_unverified_redaction');
      } else if(e.redacted===0) {
        project(projection,e);
      } else throw Error('journal_redaction_state_invalid');
      beforeCheckpoint(e); // deterministic fault injection to test crash rollback
      const updated=projection.prepare(
        'UPDATE recovery_checkpoint SET seq=? WHERE singleton=1 AND seq=?'
      ).run(e.seq,last);
      if (updated.changes!==1) throw Error('journal_checkpoint_conflict');
      projection.exec('COMMIT');
      applied++;
    } catch (error) {
      projection.exec('ROLLBACK');
      throw error;
    }
  }
  return {applied,lastSeq:projection.prepare('SELECT seq FROM recovery_checkpoint WHERE singleton=1').get().seq};
}

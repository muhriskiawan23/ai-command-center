// Synthetic/offline design proof only. Never imported by the production Worker.
// The journal and projection MUST use distinct SQLite databases in the tests.
// No production data, Cloudflare connections, or user-content telemetry.
const KINDS = new Set([
  'account.created', 'conversation.created', 'message.saved',
  'conversation.renamed', 'conversation.deleted', 'account.deleted'
]);
const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{2,100}$/.test(x);
const textValue = (x, max = 16000) => typeof x === 'string' && x.length > 0 && x.length <= max;
const requireValid = yes => { if (!yes) throw Error('invalid_journal_event'); };

export function initSyntheticJournal(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS recovery_journal(' +
    'seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,' +
    'user_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,' +
    'version INTEGER NOT NULL CHECK(version=1));' +
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
    'title TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS recovered_messages(' +
    'message_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES recovered_conversations(conversation_id) ON DELETE CASCADE,' +
    'user_id TEXT NOT NULL REFERENCES recovered_accounts(user_id) ON DELETE CASCADE,' +
    "role TEXT NOT NULL CHECK(role IN ('user','assistant'))," +
    'content TEXT NOT NULL);'
  );
}

// Domain validation deliberately fail-closed. This is NOT a production event schema.
function validate(input) {
  requireValid(input && typeof input === 'object' && !Array.isArray(input));
  const {event_id, user_id, kind, payload} = input;
  requireValid(validId(event_id) && validId(user_id) && KINDS.has(kind));
  requireValid(payload && typeof payload === 'object' && !Array.isArray(payload));
  if (kind === 'conversation.created') {
    requireValid(validId(payload.conversation_id) && textValue(payload.title, 180));
  } else if (kind === 'message.saved') {
    requireValid(validId(payload.conversation_id) && validId(payload.message_id));
    requireValid(['user','assistant'].includes(payload.role) && textValue(payload.content));
  } else if (kind === 'conversation.renamed') {
    requireValid(validId(payload.conversation_id) && textValue(payload.title, 180));
  } else if (kind === 'conversation.deleted') {
    requireValid(validId(payload.conversation_id));
  } else {
    requireValid(Object.keys(payload).length === 0);
  }
  // Reject unknown fields instead of silently ignoring security-relevant mutations.
  const allowed = {
    'account.created':[], 'account.deleted':[],
    'conversation.created':['conversation_id','title'],
    'message.saved':['conversation_id','message_id','role','content'],
    'conversation.renamed':['conversation_id','title'],
    'conversation.deleted':['conversation_id']
  }[kind];
  requireValid(Object.keys(payload).every(k => allowed.includes(k)) &&
    Object.keys(payload).length === allowed.length);
  return {event_id, user_id, kind, payload_json:JSON.stringify(payload)};
}

export function appendSyntheticEvent(db, input) {
  const e = validate(input);
  const existing = db.prepare(
    'SELECT seq,user_id,kind,payload_json FROM recovery_journal WHERE event_id=?'
  ).get(e.event_id);
  if (existing) {
    if (existing.user_id!==e.user_id || existing.kind!==e.kind ||
        existing.payload_json!==e.payload_json) throw Error('event_id_conflict');
    return {seq:existing.seq,duplicate:true};
  }
  if (db.prepare(
    "SELECT 1 AS found FROM recovery_journal WHERE user_id=? AND kind='account.deleted' LIMIT 1"
  ).get(e.user_id)) throw Error('deleted_account_event');
  const inserted = db.prepare(
    'INSERT INTO recovery_journal(event_id,user_id,kind,payload_json,version) VALUES(?,?,?,?,1)'
  ).run(e.event_id,e.user_id,e.kind,e.payload_json);
  return {seq:Number(inserted.lastInsertRowid),duplicate:false};
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
  } else if (e.kind==='conversation.renamed') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    db.prepare('UPDATE recovered_conversations SET title=? WHERE conversation_id=? AND user_id=?')
      .run(p.title,p.conversation_id,e.user_id);
  } else if (e.kind==='conversation.deleted') {
    requireOwnedConversation(db,e.user_id,p.conversation_id);
    db.prepare('INSERT INTO recovered_conversation_tombstones(user_id,conversation_id) VALUES(?,?)')
      .run(e.user_id,p.conversation_id);
    db.prepare('DELETE FROM recovered_conversations WHERE conversation_id=? AND user_id=?')
      .run(p.conversation_id,e.user_id);
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
      'SELECT seq,event_id,user_id,kind,payload_json,version FROM recovery_journal WHERE seq>? ORDER BY seq LIMIT 1'
    ).get(last);
    if (!e) break;
    if (e.seq!==last+1 || e.version!==1) throw Error('journal_sequence_gap_or_version');
    projection.exec('BEGIN IMMEDIATE');
    try {
      project(projection,e);
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

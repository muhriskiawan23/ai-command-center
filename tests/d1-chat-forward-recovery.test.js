import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Synthetic in-memory SQL only. No Cloudflare, live messages, production restore or provider calls.
const migrations = new URL('../migrations/', import.meta.url);
const baseline = readdirSync(migrations).filter(name =>
  /^(?:000[1-9]|001[01])_.*\.sql$/.test(name)).sort();
const image = ['0012_image_jobs.sql', '0016_image_chat_history.sql'];

test('forward-only repair after image schema migration retains both old and newer chat', () => {
  assert.equal(baseline.length, 11);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of baseline) db.exec(readFileSync(new URL(name, migrations), 'utf8'));
    db.prepare('INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('owner-1', 'private@example.test', 'Test', '', 100, 100);
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run('synthetic-token-hash', 'owner-1', 99999, 100);
    const insertChat = db.prepare('INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)');
    const insertMessage = db.prepare('INSERT INTO messages(conversation_id,user_id,role,content,created_at,idempotency_key) VALUES(?,?,?,?,?,?)');
    insertChat.run('c1', 'owner-1', 'Original conversation', 100, 100);
    insertMessage.run('c1', 'owner-1', 'user', 'before checkpoint', 101, 'request-old');
    insertMessage.run('c1', 'owner-1', 'assistant', 'old answer', 102, null);

    // These are additive feature migrations, not a Time Travel restore.
    for (const name of image) db.exec(readFileSync(new URL(name, migrations), 'utf8'));
    assert.ok(db.prepare('PRAGMA table_info(image_jobs)').all().some(r => r.name === 'conversation_id'));

    // Both an existing and a newly created conversation receive post-checkpoint writes.
    insertMessage.run('c1', 'owner-1', 'user', 'new turn must survive feature repair', 201, 'request-new');
    insertMessage.run('c1', 'owner-1', 'assistant', 'new answer must survive', 202, null);
    insertChat.run('c2', 'owner-1', 'New conversation', 203, 203);
    insertMessage.run('c2', 'owner-1', 'user', 'another new conversation', 204, 'request-second-new');
    insertMessage.run('c2', 'owner-1', 'assistant', 'another new answer', 205, null);

    // Example forward-only corrective schema change. Does not roll back the primary database.
    db.exec('CREATE INDEX IF NOT EXISTS image_jobs_safe_forward_fix ON image_jobs(updated_at)');

    assert.deepEqual(
      db.prepare('SELECT conversation_id,role,content FROM messages ORDER BY id').all().map(x => [x.conversation_id, x.role, x.content]),
      [
        ['c1', 'user', 'before checkpoint'],
        ['c1', 'assistant', 'old answer'],
        ['c1', 'user', 'new turn must survive feature repair'],
        ['c1', 'assistant', 'new answer must survive'],
        ['c2', 'user', 'another new conversation'],
        ['c2', 'assistant', 'another new answer']
      ]
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('image schema workflow never performs destructive Time Travel or automatic chat restore', () => {
  const release = readFileSync(new URL('../.github/workflows/bor-ai-image-d1-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(release, /d1\s+time-travel\s+restore|d1\s+backup\s+restore|time_travel\/restore/i);
  assert.match(release, /phase:\n\s+description:[^\n]+\n\s+required: true/);
  const runbook = readFileSync(new URL('../docs/CHAT-CONTINUITY-NONDESTRUCTIVE-RECOVERY.md', import.meta.url), 'utf8');
  assert.match(runbook, /FORWARD|forward-only/i);
  assert.match(runbook, /NOT A LIVE ZERO-LOSS GUARANTEE/i);
  assert.match(runbook, /before acknowledging durable chat saving/i);
});

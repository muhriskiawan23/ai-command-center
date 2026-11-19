-- STAGING-only identity tables, never use production user database.
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX idx_staging_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_staging_sessions_user ON sessions(user_id);
CREATE TABLE staging_session_issue_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL);
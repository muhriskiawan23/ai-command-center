CREATE TABLE IF NOT EXISTS github_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expiry ON github_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS github_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  github_avatar_url TEXT NOT NULL DEFAULT '',
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at INTEGER NOT NULL,
  refresh_token_expires_at INTEGER,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_connections_github_user ON github_connections(github_user_id);

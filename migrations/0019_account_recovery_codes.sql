CREATE TABLE account_recovery_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  created_at INTEGER NOT NULL
);

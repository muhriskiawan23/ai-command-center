CREATE TABLE IF NOT EXISTS public_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  allowed_origins TEXT NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 100 CHECK(daily_limit BETWEEN 1 AND 500),
  daily_used INTEGER NOT NULL DEFAULT 0 CHECK(daily_used >= 0),
  usage_day TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_public_api_keys_user_created
  ON public_api_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_keys_hash
  ON public_api_keys(key_hash);

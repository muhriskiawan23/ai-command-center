-- Dedicated staging D1 only. Never apply to bor-ai-chat or billing databases.
CREATE TABLE IF NOT EXISTS browser_staging_usage (
  day TEXT PRIMARY KEY,
  reserved_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (reserved_seconds >= 0 AND reserved_seconds <= 120)
);
CREATE TABLE IF NOT EXISTS browser_staging_lease (
  slot INTEGER PRIMARY KEY CHECK (slot = 1),
  owner_token TEXT NOT NULL,
  expires_ms INTEGER NOT NULL CHECK (expires_ms > 0)
);

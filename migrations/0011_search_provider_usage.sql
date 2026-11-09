-- Shared, privacy-preserving provider request budgets and aggregate daily metrics.
-- Store provider-level counters only; never persist queries, user IDs, IP addresses, or credentials.
CREATE TABLE IF NOT EXISTS search_provider_usage (
  day TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('tavily', 'brave')),
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  successes INTEGER NOT NULL DEFAULT 0 CHECK (successes >= 0),
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  rate_limited INTEGER NOT NULL DEFAULT 0 CHECK (rate_limited >= 0),
  last_reason TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, provider)
);
CREATE INDEX IF NOT EXISTS idx_search_provider_usage_day
  ON search_provider_usage(day);

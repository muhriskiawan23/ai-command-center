-- Global UTC admission ledger. No queries, account IDs or URLs are stored.
CREATE TABLE IF NOT EXISTS web_search_v2_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL CHECK (calls > 0),
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0)
);

-- Future monetization schema. Additive only; does not activate billing or change existing daily_usage.
-- Apply only after separate production migration review.
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id TEXT PRIMARY KEY,
  balance_microcredits INTEGER NOT NULL DEFAULT 0 CHECK(balance_microcredits >= 0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta_microcredits INTEGER NOT NULL CHECK(delta_microcredits != 0),
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, reason, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_created ON credit_ledger(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS credit_reservations (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reserved_microcredits INTEGER NOT NULL CHECK(reserved_microcredits > 0),
  settled_microcredits INTEGER CHECK(settled_microcredits >= 0 AND settled_microcredits <= reserved_microcredits),
  status TEXT NOT NULL CHECK(status IN ('reserved', 'settled', 'released')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((status = 'settled' AND settled_microcredits IS NOT NULL) OR (status != 'settled' AND settled_microcredits IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_status ON credit_reservations(user_id, status);

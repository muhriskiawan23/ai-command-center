-- Isolated synthetic credit tables for Midtrans Sandbox.
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id TEXT PRIMARY KEY,
  balance_microcredits INTEGER NOT NULL CHECK (balance_microcredits >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta_microcredits INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reason, reference_id)
);

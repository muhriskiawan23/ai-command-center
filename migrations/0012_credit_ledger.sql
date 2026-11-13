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

-- One INSERT reserves, debits and journals atomically inside SQLite.
-- RAISE(ABORT) cancels the entire INSERT and all trigger effects on insufficient funds.
CREATE TRIGGER IF NOT EXISTS trg_credit_reservation_atomic
BEFORE INSERT ON credit_reservations
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE credit_accounts
  SET balance_microcredits = balance_microcredits - NEW.reserved_microcredits,
      updated_at = NEW.created_at
  WHERE user_id = NEW.user_id
    AND balance_microcredits >= NEW.reserved_microcredits;
  SELECT RAISE(ABORT, 'insufficient_credit_balance') WHERE changes() != 1;
  INSERT INTO credit_ledger (id, user_id, delta_microcredits, reason, reference_id, created_at)
  VALUES ('reserve:' || NEW.request_id, NEW.user_id, -NEW.reserved_microcredits, 'reserve', NEW.request_id, NEW.created_at);
END;

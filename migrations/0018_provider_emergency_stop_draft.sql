-- FUTURE/UNAPPLIED: D1-coordinated emergency pause for NEW provider spend.
-- No runtime admin API or production deployment is included. Operator writes
-- require an independently reviewed, access-controlled change procedure.
-- All providers, including media, share this conservative spending boundary.
-- Default: OFF. Missing/corrupt control state fails closed during INSERT.
CREATE TABLE IF NOT EXISTS provider_runtime_controls (
  control_name TEXT PRIMARY KEY NOT NULL
    CHECK (control_name = 'paid_provider_dispatch'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

INSERT OR IGNORE INTO provider_runtime_controls
  (control_name,enabled,updated_at)
VALUES ('paid_provider_dispatch',0,0);

-- SQLite executes all triggers for one INSERT atomically. If this guard
-- aborts after another BEFORE INSERT trigger, earlier budget changes roll
-- back together; neither provider nor global reservation can leak.
CREATE TRIGGER IF NOT EXISTS trg_provider_runtime_spending_disabled
BEFORE INSERT ON provider_budget_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM provider_runtime_controls
  WHERE control_name='paid_provider_dispatch' AND enabled=1
)
BEGIN
  SELECT RAISE(ABORT,'paid_provider_dispatch_disabled');
END;

-- Preserve the single auditable control row; disabling must be an UPDATE.
CREATE TRIGGER IF NOT EXISTS trg_provider_runtime_control_no_delete
BEFORE DELETE ON provider_runtime_controls
BEGIN
  SELECT RAISE(ABORT,'provider_runtime_control_delete_forbidden');
END;

CREATE TRIGGER IF NOT EXISTS trg_provider_runtime_control_name_immutable
BEFORE UPDATE ON provider_runtime_controls
WHEN NEW.control_name!=OLD.control_name OR NEW.updated_at<OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'provider_runtime_control_invalid_update');
END;

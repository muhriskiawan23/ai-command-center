-- FUTURE / INACTIVE / ADDITIVE. DO NOT APPLY TO PRODUCTION.
-- Additional financial-history defense in depth on top of unapplied 0012.
-- Requires independently reviewed migration and explicit founder authorization.
-- Does not turn on credit billing, payment, model usage or new credits.
--
-- 0012 credit_reservations already uses guarded one-way state transitions,
-- but its linked credit_ledger lacked direct UPDATE/DELETE prohibitions.
-- No customer or operator should erase or rewrite historical debit/refund rows.
-- Legitimate grants, reserves, refunds, and compensating entries must INSERT
-- separate ledger events with authenticated reason and distinct reference IDs.
CREATE TRIGGER IF NOT EXISTS trg_credit_ledger_append_only_update
BEFORE UPDATE ON credit_ledger
BEGIN
  SELECT RAISE(ABORT,'credit_ledger_append_only_update_forbidden');
END;

CREATE TRIGGER IF NOT EXISTS trg_credit_ledger_append_only_delete
BEFORE DELETE ON credit_ledger
BEGIN
  SELECT RAISE(ABORT,'credit_ledger_append_only_delete_forbidden');
END;

-- SQLite INSERT OR REPLACE can delete a conflicting row internally without
-- invoking DELETE triggers if recursive_triggers is OFF. Prevent that bypass
-- at the BEFORE INSERT stage as well. A repeated id or canonical financial
-- reference is never an authorization to replace a financial history event.
CREATE TRIGGER IF NOT EXISTS trg_credit_ledger_no_replace
BEFORE INSERT ON credit_ledger
WHEN EXISTS (
  SELECT 1 FROM credit_ledger old
  WHERE old.id = NEW.id
     OR (old.user_id = NEW.user_id
         AND old.reason = NEW.reason
         AND old.reference_id = NEW.reference_id)
)
BEGIN
  SELECT RAISE(ABORT,'credit_ledger_duplicate_or_replace_forbidden');
END;

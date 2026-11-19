-- BOR AI ISOLATED BILLING STAGING ONLY, migration 0007.
-- No production D1, no live model debit, no real customer entitlements.
-- A hold is a worst-case reservation for a single synthetic AI/tool request.
-- It does NOT create a ledger debit until verified measured usage is finalized.
CREATE TABLE billing_usage_reservations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 10 AND 160),
  model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 128),
  rate_version TEXT NOT NULL CHECK(length(rate_version) BETWEEN 1 AND 128),
  max_input_tokens INTEGER NOT NULL CHECK(max_input_tokens BETWEEN 0 AND 1000000000),
  max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 0 AND 1000000000),
  max_tool_credits INTEGER NOT NULL CHECK(max_tool_credits BETWEEN 0 AND 1000000000),
  input_rate_micro_usd INTEGER NOT NULL CHECK(input_rate_micro_usd BETWEEN 1 AND 9007199254740991),
  output_rate_micro_usd INTEGER NOT NULL CHECK(output_rate_micro_usd BETWEEN 1 AND 9007199254740991),
  tool_rate_micro_usd INTEGER NOT NULL CHECK(tool_rate_micro_usd BETWEEN 1 AND 9007199254740991),
  credit_value_micro_usd INTEGER NOT NULL CHECK(credit_value_micro_usd BETWEEN 1 AND 9007199254740991),
  max_credits INTEGER NOT NULL CHECK(max_credits BETWEEN 1 AND 1000000000),
  status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','settled','released')),
  held_at INTEGER NOT NULL CHECK(held_at>=0),
  finalized_at INTEGER,
  billed_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(billed_input_tokens>=0),
  billed_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(billed_output_tokens>=0),
  billed_tool_credits INTEGER NOT NULL DEFAULT 0 CHECK(billed_tool_credits>=0),
  finalized_credits INTEGER NOT NULL DEFAULT 0 CHECK(finalized_credits BETWEEN 0 AND 1000000000),
  PRIMARY KEY(user_id,request_id),
  CHECK(
    (status='held' AND finalized_at IS NULL AND billed_input_tokens=0
      AND billed_output_tokens=0 AND billed_tool_credits=0 AND finalized_credits=0)
    OR (status='settled' AND finalized_at>=held_at
      AND billed_input_tokens<=max_input_tokens
      AND billed_output_tokens<=max_output_tokens
      AND billed_tool_credits<=max_tool_credits
      AND finalized_credits<=max_credits)
    OR (status='released' AND finalized_at>=held_at AND billed_input_tokens=0
      AND billed_output_tokens=0 AND billed_tool_credits=0 AND finalized_credits=0)
  )
);
CREATE INDEX billing_usage_reservations_active
  ON billing_usage_reservations(user_id,status);

-- Reservations are allocated atomically in SQLite before an outbound call.
-- Outstanding holds and existing debits compete for the SAME wallet.
CREATE TRIGGER billing_usage_hold_capacity BEFORE INSERT ON billing_usage_reservations
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM billing_wallets w
    WHERE w.user_id=NEW.user_id AND w.debt_credits=0 AND
      w.available_credits>=NEW.max_credits+
        COALESCE((SELECT SUM(r.max_credits) FROM billing_usage_reservations r
          WHERE r.user_id=NEW.user_id AND r.status='held'),0)
  ) THEN RAISE(ABORT,'billing_reserved_credits_insufficient') END;
END;

-- Older unreserved debit helper must ALSO respect active holds.
-- Add a separate trigger: do not modify existing payment/ledger validation.
CREATE TRIGGER billing_usage_debit_holds_guard BEFORE INSERT ON billing_credit_ledger
WHEN NEW.event_type='usage'
BEGIN
  SELECT CASE WHEN
    COALESCE((SELECT w.available_credits FROM billing_wallets w
      WHERE w.user_id=NEW.user_id AND w.debt_credits=0),0)
    < (-NEW.delta)+COALESCE((SELECT SUM(r.max_credits)
      FROM billing_usage_reservations r WHERE r.user_id=NEW.user_id AND r.status='held'),0)
  THEN RAISE(ABORT,'billing_reserved_credits_insufficient') END;
END;

CREATE TRIGGER billing_usage_reservation_immutable BEFORE UPDATE ON billing_usage_reservations
WHEN OLD.status<>'held' OR NEW.status NOT IN ('settled','released')
  OR NEW.user_id<>OLD.user_id OR NEW.request_id<>OLD.request_id
  OR NEW.model_id<>OLD.model_id OR NEW.rate_version<>OLD.rate_version
  OR NEW.max_input_tokens<>OLD.max_input_tokens
  OR NEW.max_output_tokens<>OLD.max_output_tokens
  OR NEW.max_tool_credits<>OLD.max_tool_credits
  OR NEW.input_rate_micro_usd<>OLD.input_rate_micro_usd
  OR NEW.output_rate_micro_usd<>OLD.output_rate_micro_usd
  OR NEW.tool_rate_micro_usd<>OLD.tool_rate_micro_usd
  OR NEW.credit_value_micro_usd<>OLD.credit_value_micro_usd
  OR NEW.max_credits<>OLD.max_credits OR NEW.held_at<>OLD.held_at
BEGIN
  SELECT RAISE(ABORT,'billing_usage_reservation_immutable');
END;
CREATE TRIGGER billing_usage_reservation_no_delete BEFORE DELETE ON billing_usage_reservations
BEGIN
  SELECT RAISE(ABORT,'billing_usage_reservation_append_only');
END;

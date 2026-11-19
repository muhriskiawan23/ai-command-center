-- BOR AI billing STAGING ONLY: manual Basic/Pro entitlement periods.
-- No live payment, no automatic debit, no production auth or API route.
-- Every period requires a distinct already-paid, independently verified
-- synthetic Duitku order and its exactly-once test-credit grant.
CREATE TABLE billing_subscription_terms (
  order_id TEXT PRIMARY KEY REFERENCES billing_orders(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL CHECK(sku IN ('basic','pro')),
  period_start_ms INTEGER NOT NULL CHECK(period_start_ms>=0),
  period_end_ms INTEGER NOT NULL,
  issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>=0),
  renewal_mode TEXT NOT NULL DEFAULT 'manual_only'
    CHECK(renewal_mode='manual_only'),
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0
    CHECK(cancel_at_period_end IN (0,1)),
  revoked_at_ms INTEGER,
  revoked_reason TEXT CHECK(revoked_reason IN ('refund','chargeback')),
  CHECK(period_end_ms>period_start_ms
    AND period_end_ms-period_start_ms<=32*86400000),
  CHECK((revoked_at_ms IS NULL AND revoked_reason IS NULL) OR
    (revoked_at_ms IS NOT NULL AND revoked_at_ms>=issued_at_ms
      AND revoked_reason IS NOT NULL))
);
CREATE INDEX billing_subscription_terms_user_period
  ON billing_subscription_terms(user_id,period_start_ms DESC);

CREATE TRIGGER billing_subscription_requires_paid_order
BEFORE INSERT ON billing_subscription_terms
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id
    WHERE o.id=NEW.order_id AND o.user_id=NEW.user_id
      AND o.status='paid' AND o.updated_at<=NEW.issued_at_ms
      AND q.sku=NEW.sku AND o.provider_reference IS NOT NULL
      AND (SELECT COUNT(*) FROM billing_payment_events e
        WHERE e.order_id=o.id AND e.event_type='payment_verified'
        AND e.signature_checked=1 AND e.status_checked=1
        AND e.provider_reference=o.provider_reference)=1
      AND (SELECT COUNT(*) FROM billing_credit_ledger l
        WHERE l.order_id=o.id AND l.event_type='grant'
          AND l.user_id=o.user_id AND l.delta=q.proposed_credits)=1
  ) THEN RAISE(ABORT,'billing_term_unverified_payment') END;
  SELECT CASE WHEN NEW.period_start_ms<NEW.issued_at_ms
    OR EXISTS(
      SELECT 1 FROM billing_subscription_terms t
      WHERE t.user_id=NEW.user_id AND t.revoked_at_ms IS NULL
        AND NEW.period_start_ms<t.period_end_ms
        AND NEW.period_end_ms>t.period_start_ms
    )
  THEN RAISE(ABORT,'billing_term_overlapping_or_backdated') END;
END;

CREATE TRIGGER billing_subscription_immutable_snapshot
BEFORE UPDATE ON billing_subscription_terms
WHEN NEW.order_id<>OLD.order_id OR NEW.user_id<>OLD.user_id
  OR NEW.sku<>OLD.sku OR NEW.period_start_ms<>OLD.period_start_ms
  OR NEW.period_end_ms<>OLD.period_end_ms OR NEW.issued_at_ms<>OLD.issued_at_ms
  OR NEW.renewal_mode<>OLD.renewal_mode
  OR NEW.cancel_at_period_end<OLD.cancel_at_period_end
  OR (OLD.revoked_at_ms IS NOT NULL AND
    (NEW.revoked_at_ms IS NOT OLD.revoked_at_ms
      OR NEW.revoked_reason IS NOT OLD.revoked_reason))
BEGIN
  SELECT RAISE(ABORT,'billing_subscription_snapshot_immutable');
END;
CREATE TRIGGER billing_subscription_revocation_proof
BEFORE UPDATE OF revoked_at_ms,revoked_reason ON billing_subscription_terms
WHEN OLD.revoked_at_ms IS NULL AND NEW.revoked_at_ms IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM billing_orders o
    JOIN billing_payment_events e ON e.order_id=o.id
    JOIN billing_credit_ledger l ON l.order_id=o.id AND l.user_id=o.user_id
    JOIN billing_quotes q ON q.id=o.quote_id
    WHERE o.id=NEW.order_id AND o.user_id=NEW.user_id
      AND o.status=CASE NEW.revoked_reason WHEN 'refund' THEN 'refunded'
        WHEN 'chargeback' THEN 'chargeback' ELSE 'INVALID' END
      AND e.event_type=CASE NEW.revoked_reason WHEN 'refund' THEN 'refund_verified'
        WHEN 'chargeback' THEN 'chargeback_verified' ELSE 'INVALID' END
      AND e.signature_checked=1 AND e.status_checked=1
      AND e.provider_reference=o.provider_reference
      AND l.event_type=NEW.revoked_reason AND l.delta=-q.proposed_credits
  ) THEN RAISE(ABORT,'billing_subscription_reversal_unverified') END;
END;
CREATE TRIGGER billing_subscription_no_delete
BEFORE DELETE ON billing_subscription_terms
BEGIN SELECT RAISE(ABORT,'billing_subscription_append_only'); END;

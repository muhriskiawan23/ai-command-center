-- BOR AI billing foundations. MIGRATION ONLY: no route, payment or paid feature is enabled.
-- Amounts: integer micro-USD, integer IDR, exact integer FX micro-IDR/USD and whole credits.
-- User identity is always bound to existing signed-in users; no guest wallets.
-- All events in this phase are synthetic_test. A future reviewed migration + provider
-- verification adapter is required before any actual customer grant.
CREATE TABLE billing_quotes (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 10 AND 90),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL CHECK(sku IN ('basic','pro','topup')),
  price_usd_micro INTEGER NOT NULL CHECK(price_usd_micro BETWEEN 1 AND 1000000000000),
  proposed_credits INTEGER NOT NULL CHECK(proposed_credits BETWEEN 1 AND 1000000000),
  tariff_version TEXT NOT NULL CHECK(length(tariff_version) BETWEEN 1 AND 128),
  fx_rate_micro_idr_per_usd INTEGER NOT NULL CHECK(fx_rate_micro_idr_per_usd BETWEEN 1 AND 100000000000),
  fx_source TEXT NOT NULL CHECK(length(fx_source) BETWEEN 1 AND 128),
  quoted_idr INTEGER NOT NULL CHECK(quoted_idr BETWEEN 1 AND 1000000000000),
  gateway_method TEXT NOT NULL CHECK(length(gateway_method) BETWEEN 1 AND 40),
  gateway_fee_idr INTEGER NOT NULL CHECK(gateway_fee_idr>=0),
  gateway_fee_source TEXT NOT NULL CHECK(length(gateway_fee_source) BETWEEN 1 AND 128),
  gateway_fee_tax_idr INTEGER NOT NULL CHECK(gateway_fee_tax_idr>=0),
  provider_budget_idr INTEGER NOT NULL CHECK(provider_budget_idr>=0),
  fx_reserve_idr INTEGER NOT NULL CHECK(fx_reserve_idr>=0),
  refund_reserve_idr INTEGER NOT NULL CHECK(refund_reserve_idr>=0),
  other_variable_costs_idr INTEGER NOT NULL CHECK(other_variable_costs_idr>=0),
  contribution_idr INTEGER NOT NULL,
  required_contribution_idr INTEGER NOT NULL CHECK(required_contribution_idr>=0),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK(expires_at>issued_at AND expires_at-issued_at<=900000),
  CHECK(contribution_idr>=required_contribution_idr),
  CHECK((sku='basic' AND price_usd_micro=1990000) OR
        (sku='pro' AND price_usd_micro=6990000) OR sku='topup')
);
CREATE INDEX billing_quotes_owner ON billing_quotes(user_id,issued_at DESC);
-- The quote/FX snapshot is immutable after issue, even if the underlying tariff changes.
CREATE TRIGGER billing_quotes_immutable_update BEFORE UPDATE ON billing_quotes
BEGIN SELECT RAISE(ABORT,'billing_quote_immutable'); END;
CREATE TRIGGER billing_quotes_immutable_delete BEFORE DELETE ON billing_quotes
BEGIN SELECT RAISE(ABORT,'billing_quote_immutable'); END;

CREATE TABLE billing_orders (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 10 AND 90),
  quote_id TEXT NOT NULL UNIQUE REFERENCES billing_quotes(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(provider='duitku'),
  provider_reference TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refunded','chargeback')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX billing_orders_owner ON billing_orders(user_id,created_at DESC);
CREATE TRIGGER billing_order_creation_guard BEFORE INSERT ON billing_orders
BEGIN
  SELECT CASE WHEN NEW.status<>'pending' OR NEW.provider_reference IS NOT NULL OR
    NOT EXISTS(
      SELECT 1 FROM billing_quotes q WHERE q.id=NEW.quote_id AND q.user_id=NEW.user_id
      AND NEW.created_at>=q.issued_at AND NEW.created_at<q.expires_at
    ) THEN RAISE(ABORT,'billing_quote_expired_or_wrong_owner') END;
END;
CREATE TRIGGER billing_order_immutable_fields BEFORE UPDATE ON billing_orders
WHEN NEW.id<>OLD.id OR NEW.quote_id<>OLD.quote_id OR NEW.user_id<>OLD.user_id
 OR NEW.provider<>OLD.provider OR
 (OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS NOT OLD.provider_reference)
BEGIN SELECT RAISE(ABORT,'billing_order_snapshot_immutable'); END;
CREATE TRIGGER billing_order_immutable_delete BEFORE DELETE ON billing_orders
BEGIN SELECT RAISE(ABORT,'billing_order_immutable'); END;

CREATE TABLE billing_payment_events (
  event_key TEXT PRIMARY KEY CHECK(length(event_key) BETWEEN 10 AND 160),
  order_id TEXT NOT NULL REFERENCES billing_orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('payment_verified','refund_verified','chargeback_verified')),
  provider_reference TEXT NOT NULL CHECK(length(provider_reference) BETWEEN 1 AND 255),
  amount_idr INTEGER NOT NULL CHECK(amount_idr>0),
  signature_checked INTEGER NOT NULL CHECK(signature_checked=1),
  status_checked INTEGER NOT NULL CHECK(status_checked=1),
  verification_mode TEXT NOT NULL CHECK(verification_mode='synthetic_test'),
  checked_at INTEGER NOT NULL,
  UNIQUE(order_id,event_type),
  UNIQUE(provider_reference,event_type)
);
CREATE INDEX billing_events_order ON billing_payment_events(order_id,checked_at);
CREATE TRIGGER billing_events_immutable_update BEFORE UPDATE ON billing_payment_events
BEGIN SELECT RAISE(ABORT,'billing_event_immutable'); END;
CREATE TRIGGER billing_events_immutable_delete BEFORE DELETE ON billing_payment_events
BEGIN SELECT RAISE(ABORT,'billing_event_immutable'); END;
CREATE TRIGGER billing_event_validate BEFORE INSERT ON billing_payment_events
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id
    WHERE o.id=NEW.order_id AND q.quoted_idr=NEW.amount_idr
      AND ((NEW.event_type='payment_verified' AND o.status='pending')
        OR (NEW.event_type IN ('refund_verified','chargeback_verified') AND o.status='paid'
          AND o.provider_reference=NEW.provider_reference))
  ) THEN RAISE(ABORT,'billing_event_order_amount_or_state_mismatch') END;
END;

CREATE TABLE billing_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  available_credits INTEGER NOT NULL DEFAULT 0 CHECK(available_credits BETWEEN 0 AND 9007199254740991),
  debt_credits INTEGER NOT NULL DEFAULT 0 CHECK(debt_credits BETWEEN 0 AND 9007199254740991),
  updated_at INTEGER NOT NULL
);
CREATE TABLE billing_credit_ledger (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 10 AND 180),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES billing_orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('grant','usage','refund','chargeback')),
  source_key TEXT NOT NULL CHECK(length(source_key) BETWEEN 1 AND 160),
  delta INTEGER NOT NULL CHECK(delta<>0 AND delta BETWEEN -1000000000 AND 1000000000),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,event_type,source_key),
  UNIQUE(order_id,event_type)
);
CREATE INDEX billing_ledger_owner ON billing_credit_ledger(user_id,created_at DESC);
CREATE TRIGGER billing_ledger_immutable_update BEFORE UPDATE ON billing_credit_ledger
BEGIN SELECT RAISE(ABORT,'billing_ledger_append_only'); END;
CREATE TRIGGER billing_ledger_immutable_delete BEFORE DELETE ON billing_credit_ledger
BEGIN SELECT RAISE(ABORT,'billing_ledger_append_only'); END;
CREATE TRIGGER billing_ledger_validate BEFORE INSERT ON billing_credit_ledger
BEGIN
  SELECT CASE
    WHEN NEW.event_type='usage' AND (
       NEW.order_id IS NOT NULL OR NEW.delta>=0 OR
       NOT EXISTS(SELECT 1 FROM billing_wallets w WHERE w.user_id=NEW.user_id
         AND w.debt_credits=0 AND w.available_credits>=-NEW.delta)
    ) THEN RAISE(ABORT,'billing_insufficient_or_frozen')
    WHEN NEW.event_type<>'usage' AND NOT EXISTS(
      SELECT 1 FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id
      WHERE o.id=NEW.order_id AND o.user_id=NEW.user_id AND NEW.source_key=o.id
      AND ((NEW.event_type='grant' AND o.status='paid' AND NEW.delta=q.proposed_credits)
        OR (NEW.event_type='refund' AND o.status='refunded' AND NEW.delta=-q.proposed_credits)
        OR (NEW.event_type='chargeback' AND o.status='chargeback' AND NEW.delta=-q.proposed_credits))
    ) THEN RAISE(ABORT,'billing_invalid_ledger_provenance')
  END;
END;
-- This projection is updated atomically with ledger insertions by SQLite.
-- Negative reversals consume unspent balance first and create debt for spent credits.
-- Subsequent grants settle debt before restoring spendable credits.
CREATE TRIGGER billing_ledger_project AFTER INSERT ON billing_credit_ledger
BEGIN
  INSERT INTO billing_wallets(user_id,available_credits,debt_credits,updated_at)
    VALUES(NEW.user_id,MAX(0,NEW.delta),MAX(0,-NEW.delta),NEW.created_at)
  ON CONFLICT(user_id) DO UPDATE SET
    available_credits=CASE WHEN NEW.delta>0
      THEN billing_wallets.available_credits+MAX(0,NEW.delta-billing_wallets.debt_credits)
      ELSE MAX(0,billing_wallets.available_credits+NEW.delta) END,
    debt_credits=CASE WHEN NEW.delta>0
      THEN MAX(0,billing_wallets.debt_credits-NEW.delta)
      ELSE billing_wallets.debt_credits+MAX(0,-NEW.delta-billing_wallets.available_credits) END,
    updated_at=NEW.created_at;
END;

-- An event is only accepted for exact quoted IDR amount and eligible order status.
-- The event updates order state, which atomically creates the one credit entry.
CREATE TRIGGER billing_event_apply AFTER INSERT ON billing_payment_events
BEGIN
  UPDATE billing_orders
    SET status=CASE NEW.event_type
      WHEN 'payment_verified' THEN 'paid'
      WHEN 'refund_verified' THEN 'refunded'
      ELSE 'chargeback' END,
      provider_reference=COALESCE(provider_reference,NEW.provider_reference),
      updated_at=NEW.checked_at
    WHERE id=NEW.order_id;
END;
CREATE TRIGGER billing_order_state_guard BEFORE UPDATE OF status ON billing_orders
WHEN NEW.status<>OLD.status
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status='pending' AND NEW.status='paid') OR
    (OLD.status='paid' AND NEW.status IN ('refunded','chargeback'))
  ) OR NOT EXISTS(
    SELECT 1 FROM billing_payment_events e WHERE e.order_id=NEW.id AND
    e.event_type=CASE NEW.status
      WHEN 'paid' THEN 'payment_verified'
      WHEN 'refunded' THEN 'refund_verified'
      ELSE 'chargeback_verified' END
    AND e.provider_reference=COALESCE(NEW.provider_reference,'')
  ) THEN RAISE(ABORT,'billing_unverified_or_invalid_transition') END;
END;
CREATE TRIGGER billing_order_grant AFTER UPDATE OF status ON billing_orders
WHEN OLD.status='pending' AND NEW.status='paid'
BEGIN
  INSERT INTO billing_credit_ledger(id,user_id,order_id,event_type,source_key,delta,created_at)
    SELECT 'BLEDGER:grant:'||NEW.id,NEW.user_id,NEW.id,'grant',NEW.id,q.proposed_credits,NEW.updated_at
    FROM billing_quotes q WHERE q.id=NEW.quote_id;
END;
CREATE TRIGGER billing_order_clawback AFTER UPDATE OF status ON billing_orders
WHEN OLD.status='paid' AND NEW.status IN ('refunded','chargeback')
BEGIN
  INSERT INTO billing_credit_ledger(id,user_id,order_id,event_type,source_key,delta,created_at)
    SELECT 'BLEDGER:'||NEW.status||':'||NEW.id,NEW.user_id,NEW.id,
      CASE NEW.status WHEN 'refunded' THEN 'refund' ELSE 'chargeback' END,
      NEW.id,-q.proposed_credits,NEW.updated_at
    FROM billing_quotes q WHERE q.id=NEW.quote_id;
END;

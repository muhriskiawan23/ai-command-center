-- REVIEW-ONLY: not in migrations/. Requires prior credit ledger migration and D1 concurrency tests.
-- All IDR values are whole rupiah, all credit grants integer microcredits.
CREATE TABLE IF NOT EXISTS payment_orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK(currency = 'IDR'),
  amount_idr INTEGER NOT NULL CHECK(amount_idr > 0 AND amount_idr <= 9007199254740991),
  grant_microcredits INTEGER NOT NULL CHECK(grant_microcredits > 0 AND grant_microcredits <= 9007199254740991),
  state TEXT NOT NULL DEFAULT 'created' CHECK(state IN ('created','pending','paid_unfulfilled','fulfilled','failed','expired','cancelled','refunded','disputed')),
  provider_transaction_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_tx ON payment_orders(environment,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id,created_at DESC);
-- Only a verified server-side handler may mark an order paid_unfulfilled.
-- This trigger grants exactly once as part of the single UPDATE to fulfilled.
CREATE TRIGGER IF NOT EXISTS trg_payment_order_fulfill
BEFORE UPDATE OF state ON payment_orders
WHEN NEW.state = 'fulfilled' AND OLD.state = 'paid_unfulfilled'
BEGIN
  INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at)
    VALUES (OLD.user_id,0,NEW.updated_at) ON CONFLICT(user_id) DO NOTHING;
  UPDATE credit_accounts SET
    balance_microcredits = balance_microcredits + OLD.grant_microcredits,
    updated_at = NEW.updated_at
    WHERE user_id = OLD.user_id
      AND balance_microcredits <= 9007199254740991 - OLD.grant_microcredits;
  SELECT RAISE(ABORT,'payment_grant_account_missing_or_overflow') WHERE changes() != 1;
  INSERT INTO credit_ledger (id,user_id,delta_microcredits,reason,reference_id,created_at)
    VALUES ('payment:' || OLD.order_id,OLD.user_id,OLD.grant_microcredits,'payment_grant',OLD.order_id,NEW.updated_at);
END;
-- No direct state mutation to fulfilled except the paid_unfulfilled transition.
CREATE TRIGGER IF NOT EXISTS trg_payment_order_fulfill_guard
BEFORE UPDATE OF state ON payment_orders
WHEN NEW.state = 'fulfilled' AND OLD.state != 'paid_unfulfilled'
BEGIN SELECT RAISE(ABORT,'payment_fulfillment_transition_invalid'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_order_identity_guard
BEFORE UPDATE ON payment_orders
WHEN NEW.order_id != OLD.order_id OR NEW.user_id != OLD.user_id OR
 NEW.sku != OLD.sku OR NEW.amount_idr != OLD.amount_idr OR
 NEW.currency != OLD.currency OR NEW.environment != OLD.environment OR
 NEW.grant_microcredits != OLD.grant_microcredits OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT,'payment_order_identity_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_payment_order_no_delete
BEFORE DELETE ON payment_orders BEGIN SELECT RAISE(ABORT,'payment_order_delete_forbidden'); END;
-- Prevent re-fulfillment or retroactive transitions. Refund/dispute workflows require separate reversal ledger.
CREATE TRIGGER IF NOT EXISTS trg_payment_order_state_guard
BEFORE UPDATE OF state ON payment_orders
WHEN (OLD.state = 'fulfilled' AND NEW.state NOT IN ('fulfilled','refunded','disputed'))
 OR (OLD.state IN ('refunded','disputed','failed','expired','cancelled') AND NEW.state != OLD.state)
 OR (OLD.state = 'paid_unfulfilled' AND NEW.state NOT IN ('paid_unfulfilled','fulfilled','refunded','disputed'))
 OR (OLD.state = 'created' AND NEW.state NOT IN ('created','pending','paid_unfulfilled','failed','expired','cancelled'))
 OR (OLD.state = 'pending' AND NEW.state NOT IN ('pending','paid_unfulfilled','failed','expired','cancelled'))
BEGIN SELECT RAISE(ABORT,'payment_order_state_invalid'); END;

-- Never permit pre-paid or fulfilled orders to be inserted directly.
CREATE TRIGGER IF NOT EXISTS trg_payment_order_insert_guard
BEFORE INSERT ON payment_orders
WHEN NEW.state != 'created' OR NEW.provider_transaction_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'payment_order_must_start_unpaid'); END;
-- Once a provider transaction ID is bound, it cannot be replaced or cleared.
CREATE TRIGGER IF NOT EXISTS trg_payment_order_provider_identity_guard
BEFORE UPDATE OF provider_transaction_id ON payment_orders
WHEN OLD.provider_transaction_id IS NOT NULL AND
 (NEW.provider_transaction_id IS NULL OR NEW.provider_transaction_id != OLD.provider_transaction_id)
BEGIN SELECT RAISE(ABORT,'payment_provider_transaction_immutable'); END;

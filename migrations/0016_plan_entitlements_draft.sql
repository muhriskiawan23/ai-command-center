-- FUTURE / INACTIVE BOR AI subscription entitlements. NO PRODUCTION MIGRATION.
-- Order proofs below must ONLY be inserted/updated after a separately
-- authenticated Midtrans notification PLUS an authoritative Status API lookup.
-- No user-selectable endpoint is allowed to write verified_plan_payments or
-- plan_entitlements. A paid plan is never granted by a browser redirect.
-- Payment proof here is a future integration contract, not an actual
-- verification of external signatures, FX, amount, refunds or merchant status.

CREATE TABLE IF NOT EXISTS verified_plan_payments (
  order_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchased_tier TEXT NOT NULL CHECK (purchased_tier IN ('basic','pro')),
  verification_status TEXT NOT NULL CHECK (
    verification_status IN ('verified_paid','refunded','chargeback','revoked')
  ),
  verified_at INTEGER NOT NULL CHECK (verified_at > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= verified_at),
  UNIQUE(order_id, user_id, purchased_tier)
);
CREATE INDEX IF NOT EXISTS idx_verified_plan_payments_user
  ON verified_plan_payments(user_id,verification_status);

-- Only one current paid entitlement per account. Renewal must replace this
-- original payment reference with one newly verified order, never duplicate
-- entitlements or stack credits from Pro + Basic.
CREATE TABLE IF NOT EXISTS plan_entitlements (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paid_tier TEXT NOT NULL CHECK (paid_tier IN ('basic','pro')),
  payment_order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'active','pending','past_due','cancelled','revoked'
  )),
  starts_at INTEGER NOT NULL CHECK (starts_at >= 0),
  ends_at INTEGER NOT NULL CHECK (
    ends_at > starts_at AND ends_at <= starts_at + 32 * 86400
  ),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  FOREIGN KEY(payment_order_id,user_id,paid_tier)
    REFERENCES verified_plan_payments(order_id,user_id,purchased_tier)
);

-- Selected mode can be less powerful than the currently paid entitlement.
-- Selecting 'free' does not cancel a paid subscription or alter credit lots.
-- Server must atomically verify paid eligibility on each upgrade and recheck
-- before every protected request. This table alone NEVER grants paid access.
CREATE TABLE IF NOT EXISTS plan_selections (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_tier TEXT NOT NULL CHECK (selected_tier IN ('free','basic','pro')),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

-- Prevent reusing the same provider order for two different accounts/tiers.
-- The composite FKs protect cross-account entitlement assignment when D1 FK
-- enforcement is enabled. The runtime also explicitly validates the JOIN.

-- These are *ephemeral eligibility proofs*, not statutory invoice/settlement
-- archives. On verified account erasure, delete linked selection and paid
-- access rows via FK CASCADE; any lawfully retained financial invoice evidence
-- must use a separately reviewed, minimized retention system.

-- Dedicated bor-ai-duitku-sandbox database only. Never apply to bor-ai-chat.
CREATE TABLE IF NOT EXISTS duitku_sandbox_orders (
  id TEXT PRIMARY KEY CHECK (id LIKE 'BORTEST-%'),
  request_hash TEXT NOT NULL,
  merchant_code TEXT NOT NULL CHECK (merchant_code LIKE 'DS%'),
  amount_idr INTEGER NOT NULL CHECK (amount_idr = 10000),
  test_credits INTEGER NOT NULL CHECK (test_credits = 100),
  payment_method TEXT NOT NULL CHECK (payment_method = 'BT'),
  status TEXT NOT NULL CHECK (status IN ('creating','pending','provider_unknown','paid','failed')),
  reference TEXT UNIQUE,
  payment_url TEXT,
  verify_after INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS duitku_sandbox_created ON duitku_sandbox_orders(created_at);
CREATE TABLE IF NOT EXISTS duitku_sandbox_credit_ledger (
  order_id TEXT PRIMARY KEY REFERENCES duitku_sandbox_orders(id),
  test_credits INTEGER NOT NULL CHECK (test_credits = 100),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS duitku_sandbox_paid
AFTER UPDATE OF status ON duitku_sandbox_orders
WHEN NEW.status = 'paid' AND OLD.status <> 'paid'
BEGIN
  INSERT INTO duitku_sandbox_credit_ledger(order_id,test_credits,created_at)
  VALUES (NEW.id,NEW.test_credits,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS duitku_sandbox_paid_is_terminal
BEFORE UPDATE OF status ON duitku_sandbox_orders
WHEN OLD.status = 'paid' AND NEW.status <> 'paid'
BEGIN
  SELECT RAISE(ABORT,'sandbox_paid_is_terminal');
END;

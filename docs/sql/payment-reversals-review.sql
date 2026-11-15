-- Sandbox review only. Apply to a disposable database after payment-orders-review.sql.
-- Insert only independently verified full reversals. Partial and mixed cases need review.
CREATE TABLE sandbox_payment_reversals (
  order_id TEXT PRIMARY KEY REFERENCES payment_orders(order_id),
  provider_transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('refund','chargeback')),
  amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
  created_at INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','reversed','review_required'))
);

CREATE TRIGGER sandbox_reversal_apply
AFTER INSERT ON sandbox_payment_reversals
BEGIN
  SELECT RAISE(ABORT,'sandbox_reversal_mismatch')
  WHERE NEW.outcome <> 'pending' OR NOT EXISTS (
    SELECT 1 FROM payment_orders p
    WHERE p.order_id=NEW.order_id AND p.environment='sandbox'
      AND p.state='fulfilled' AND p.provider_transaction_id=NEW.provider_transaction_id
      AND p.amount_idr=NEW.amount_idr
  );
  UPDATE credit_accounts SET
    balance_microcredits=balance_microcredits-(
      SELECT grant_microcredits FROM payment_orders WHERE order_id=NEW.order_id
    ),
    updated_at=MAX(updated_at,NEW.created_at)
  WHERE user_id=(SELECT user_id FROM payment_orders WHERE order_id=NEW.order_id)
    AND balance_microcredits>=(SELECT grant_microcredits FROM payment_orders WHERE order_id=NEW.order_id);
  UPDATE sandbox_payment_reversals
    SET outcome=CASE WHEN changes()=1 THEN 'reversed' ELSE 'review_required' END
  WHERE order_id=NEW.order_id;
  INSERT INTO credit_ledger (id,user_id,delta_microcredits,reason,reference_id,created_at)
  SELECT 'reversal:'||p.order_id,p.user_id,-p.grant_microcredits,'payment_reversal',p.order_id,NEW.created_at
  FROM payment_orders p JOIN sandbox_payment_reversals r ON r.order_id=p.order_id
  WHERE p.order_id=NEW.order_id AND r.outcome='reversed';
  UPDATE payment_orders SET
    state=CASE WHEN NEW.kind='refund' THEN 'refunded' ELSE 'disputed' END,
    updated_at=MAX(updated_at,NEW.created_at)
  WHERE order_id=NEW.order_id;
END;

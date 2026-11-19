-- Limits staging-only operator-issued accounts to 3 invoices per 24h and 20 invoices global per 24h.
-- Applied after billing_orders exists. This is NOT a production deployment.
CREATE TRIGGER staging_order_quota BEFORE INSERT ON billing_orders
BEGIN
 SELECT CASE WHEN
  (SELECT COUNT(*) FROM billing_orders WHERE user_id=NEW.user_id AND created_at>=NEW.created_at-86400000)>=3
  OR (SELECT COUNT(*) FROM billing_orders WHERE created_at>=NEW.created_at-86400000)>=20
 THEN RAISE(ABORT,'staging_daily_checkout_limit') END;
END;
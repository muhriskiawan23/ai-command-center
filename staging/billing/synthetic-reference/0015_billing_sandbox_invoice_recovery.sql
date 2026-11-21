-- Optional Sandbox-only invoice URL and provider check backoff.
-- Migration stays UNAPPLIED to production until separately reviewed.
-- No checkout route or payment permission is enabled by adding these columns.
ALTER TABLE billing_orders
  ADD COLUMN sandbox_payment_url TEXT
  CHECK(sandbox_payment_url IS NULL OR (
    length(sandbox_payment_url) BETWEEN 32 AND 2048
    AND substr(sandbox_payment_url,1,27)='https://sandbox.duitku.com/'
  ));
ALTER TABLE billing_orders
  ADD COLUMN sandbox_status_check_after INTEGER NOT NULL DEFAULT 0
  CHECK(sandbox_status_check_after>=0);

CREATE TRIGGER billing_sandbox_payment_url_once
BEFORE UPDATE OF sandbox_payment_url ON billing_orders
WHEN NEW.sandbox_payment_url IS NOT OLD.sandbox_payment_url
BEGIN
  SELECT CASE WHEN OLD.sandbox_payment_url IS NOT NULL OR
    NEW.sandbox_payment_url IS NULL OR
    OLD.provider_reference IS NULL OR OLD.status<>'pending'
    THEN RAISE(ABORT,'billing_sandbox_url_immutable') END;
END;

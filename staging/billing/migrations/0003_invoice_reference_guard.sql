-- SAFETY HARDENING for the synthetic-only billing foundation.
-- Do not apply to production without the reviewed migration, privacy and finance gates.
-- A payment-verified event must use the provider reference pre-bound to the
-- specific customer order from a trusted synthetic invoice creation result.
-- Merely knowing order_id + IDR amount must not allow a synthetic grant.
CREATE TRIGGER billing_invoice_reference_guard
BEFORE UPDATE OF provider_reference ON billing_orders
WHEN OLD.provider_reference IS NULL AND
  (NEW.provider_reference IS NULL OR length(NEW.provider_reference) NOT BETWEEN 1 AND 255
   OR OLD.status<>'pending')
BEGIN
  SELECT RAISE(ABORT,'billing_invalid_invoice_reference');
END;
CREATE TRIGGER billing_payment_requires_bound_invoice
BEFORE INSERT ON billing_payment_events
WHEN NEW.event_type='payment_verified' AND NOT EXISTS (
  SELECT 1 FROM billing_orders o WHERE o.id=NEW.order_id
    AND o.provider_reference=NEW.provider_reference
    AND o.provider_reference IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'billing_unbound_invoice_reference');
END;

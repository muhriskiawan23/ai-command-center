# BOR AI — customer-specific Duitku V2 Sandbox transport (pre-deployment)

**Status:** coded and testable with mocked HTTP, NOT deployed or activated.
This is a transport contract, not a live checkout integration or financial
authorization. It is deliberately NOT imported by src/index.js or any
production/sandbox Worker entrypoint.

## Components

- src/duitku-v2-sandbox-contract.js validates the provider V2 inquiry and
  transactionStatus formats using the Sandbox origin ONLY.
- migrations/0015_billing_sandbox_invoice_recovery.sql adds the Sandbox
  invoice URL and per-order status-lookup backoff, with a one-time write guard.
  Migration 0013/0014/0015 must NOT be applied to production before a
  separate security/finance/privacy go-live review.
- src/billing-synthetic-gateway-bridge.js may accept a provider explicitly
  marked sandboxV2TransportOnly for local/staging test harnesses only.
  No checkout route exposes this module to customers.
- tests/billing-synthetic-gateway-bridge.test.js exercises fake HTTP
  responses in actual Duitku V2 format, exact IDR matching, callback signing,
  rejection of redirected/mismatched responses, issuer URL storage,
  duplicate checkout after rate expiration, status check throttling,
  a paid ledger entry written once, and no refund settlement capability.

## Critical facts and security properties

1. Duitku V2 inquiry: POST to
   https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry
   with HMAC-SHA256(merchantCode+merchantOrderId+paymentAmount,apiKey).
   Sandbox merchant must match DS[digits]; payment method fixed to BT
   until all supported channels and their exact fees are reviewed.
2. Duitku V2 transactionStatus: POST to
   https://sandbox.duitku.com/webapi/api/merchant/transactionStatus
   with HMAC-SHA256(merchantCode+merchantOrderId,apiKey).
   The raw response includes merchantOrderId, reference, amount,
   statusCode; it does NOT carry a currency field. The adapter maps this
   API's explicitly IDR-denominated contract to an internal currency
   marker, then the billing bridge compares it to the immutable quoted
   integer IDR amount and bound provider reference.
3. Callback uses the V2 HMAC signature AND the independent server-side
   transactionStatus verification. Browser returns and unsigned
   resultCode values are not payment evidence.
4. Provider redirect is manual and all 3xx/non-200 responses are
   rejected without forwarding credentials to another host. Provider
   bodies and errors are size-bounded and sanitized. A 15s maximum timeout
   is enforced. Only exact https://sandbox.duitku.com payment URLs may be
   returned and persisted.
5. The sandbox quote uses a dummy buyer email/name to avoid uploading
   customer Google profile PII during tests. No email/name is saved in
   the new billing tables. This is NOT an approved production customer
   disclosure policy.
6. The invoice creation return is persisted once. Retries use the
   original order, FX quote, invoice reference and URL, even after FX
   quote expiry. An ambiguous provider response does NOT cause a fresh
   invoice to be issued.
7. Live-style status checks are throttled to one attempt per order per
   30 seconds. Duitku explicitly warns against high-frequency status
   polling and account limits. When the provider errors, the system
   intentionally fails closed until the backoff permits retry.
8. The adapter deliberately has NO refund/chargeback method. V2
   transactionStatus=00 is evidence of *payment*, not proof of successful
   refund/dispute settlement. Duitku's SNAP refund documentation belongs
   to a different API integration; never infer VA refund support from
   that document.

## Remaining gates before live business

- Deploy a separate customer Sandbox Worker + dedicated database,
  configure a real HTTPS callback endpoint, verified auth and server-side
  pricing policy, then independently verify sandbox-to-sandbox paid and
  duplicate/late callbacks. This source module does not provide those
  endpoints and is deliberately not deployed.
- Operator must configure sandbox credentials as cloud secrets; no keys
  or bearer tokens should appear in chat, repository, shell history or CI.
- Verify live Duitku project approvals, payment method restrictions,
  merchant fees (including tax), settlement, refunds, chargebacks and
  transaction-specific recovery directly with Duitku.
- Approve tariff versions, real credit allocations/top-up price, LLM/API
  costs and FX-source/rate lock. No numeric assumption in the test
  fixture is a commercial quote or guaranteed margin.
- Resolve billing data retention/erasure obligations and threat-model
  tenant access; cross-account reconciliation must fail closed.
- Get explicit owner authorization only after a staged payment and
  business/financial audit. The real production Worker, chat quota and
  image wallet must remain untouched.

## How to test without creating invoices

node --test tests/billing-synthetic-gateway-bridge.test.js

Official Duitku reference: https://docs.duitku.com/api/en/

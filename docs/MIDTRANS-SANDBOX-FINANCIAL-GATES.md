# BOR AI — Midtrans sandbox integration and financial safety gates

Status: DESIGN ONLY. Merchant application submitted by owner; review pending. No merchant approval, live payment, production credential, or live checkout is implied. Do not enable production payments or apply credit migrations from this document.

## Business decisions

- Merchant: individual owner; legal identity and settlement bank must match gateway verification. Display name "BOR AI" depends on Midtrans approval and payment channel.
- USD is the product pricing/accounting reference. Customer pays fixed, quoted IDR at local checkout. The actual provider FX source, quote TTL, rounding, tax and refund conversion policies must be approved. Never silently use stale or fabricated FX.
- Provisional plans: Basic USD 1.99/month; Pro USD 6.99/month. Credit grants and top-up denominations are not approved. Pro-only rollover capped at proposed 25% of monthly subscription grant, one renewal period, remains disabled pending economics.
- Merchant-disclosed transaction fees (owner-provided application terms, verify before launch): VA BNI/BRI/Permata/Mandiri/CIMB/Danamon/BSI/SeaBank IDR 4,000 per successful transaction; GoPay 2% of transaction value after tax; QRIS 0.7% of transaction value after tax. Confirm fee payer, tax basis, additional tax, settlement deductions and refunds before pricing.
- No auto-renewal without supported gateway mandate and informed customer consent.

## Checkout flow

1. Authenticate user server-side. Derive user_id from session, never trust submitted user_id or product price.
2. Validate server-owned plan/credit SKU, active price version, eligibility, currency and limits.
3. Acquire verified FX rate, lock an integer-IDR quote with expiry and snapshot USD micro-units, source, timestamp, fee policy, tax and rounding. Reject when rate unavailable.
4. Create durable unique order (created/pending) with server-generated order_id, user_id, SKU, quoted amount, currency, expiry and provider idempotency key. Never expose secret credentials.
5. Create Midtrans sandbox transaction server-to-server, using documented request signing/authentication and matching order_id and amount. Return only safe redirect/token information.
6. On notification, authenticate notification per current Midtrans specification, query provider transaction status when necessary, verify order_id, gross amount, currency, merchant/environment and final status. A browser success redirect is **not** proof of payment.
7. Persist raw-event reference/hash (no secrets), normalized event, and durable processing state. Apply exactly-once entitlement issuance with unique order_id + grant_type and atomic ledger transaction. Duplicate/reordered notifications must not double grant.
8. If payment verified but entitlement issuance fails, mark paid_unfulfilled and retry safely; alert on stale pending and paid_unfulfilled orders. Never silently discard paid orders.
9. Reconcile periodically against gateway API and settlement reports. Refunds, partial refunds, disputes and chargebacks need separately audited compensating transactions and explicit customer policy.
10. User receipt must show product, IDR paid, USD price reference, FX quote, payment state, granted credits/term, transaction ID, support/refund terms.

## Order state machine

created -> pending -> paid_unfulfilled -> fulfilled
created/pending -> expired | failed | cancelled
paid_unfulfilled -> fulfilled only after idempotent grant commit
fulfilled -> refunded | disputed (compensating ledger; no destructive edits)

State transitions must be monotonic and validated against provider status. Late success after a local expiry is an exception requiring reconciliation, not a blind grant or discard.

## Mandatory security controls

- Separate Midtrans sandbox and production keys, merchant IDs, callbacks and environments. Store keys in Cloudflare secrets, not repository, logs, client code or chat.
- Webhook endpoint requires provider authentication and replay defenses. Idempotency keyed on immutable provider/order identifiers, not arbitrary user-controlled payload.
- No credits issued from a front-end callback, unverified screenshot, or payment-pending event.
- Prevent double orders/double charges from client retries with server-side idempotency and unique constraints.
- Account ownership isolation, integer money, immutable ledger, atomic grants, atomic reserve/settle/release, expiry/rollover credit lots.
- Rate limits, audit log, per-user and global spend ceilings, kill switches, anomaly detection and incident recovery.
- Test callback reordering, duplicate delivery, partial database failure, lost webhook, timeouts, refunds, chargebacks, incorrect amount, wrong currency, bad signature, cross-user attacks and simultaneous purchases.
- Reconcile balances against ledger and settlements, not just order status. Do not log personal payment data unnecessarily.

## Launch blockers

- Midtrans merchant review approved and gateway terms checked.
- Pricing, included credit amounts, provider token/Tavily costs, margins, FX policy, fee tax base and refund policy approved.
- PR #245 credit ledger reviewed with real isolated D1 tests; no unsafe balance mutation.
- Midtrans sandbox end-to-end payment + entitlement tests and independent security review passed.
- Legal/privacy/consumer-facing terms and support processes reviewed.
- Owner explicitly approves production migration, secrets configuration and enabling checkout.

**No credentials or live payment calls are authorized by this document.**

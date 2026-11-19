# BOR AI billing: authenticated synthetic gateway bridge

**NOT a customer checkout.** No production Worker route, no real Duitku API
request, no live payment, no refund transfer, and no actual user credit balance.
This is a SQL-backed offline simulation/test harness. It exists solely to
validate integration invariants before real gateway activation. Its fake
gateway and synthetic receipts must NEVER be used for live transactions.

Files:
- src/billing-synthetic-gateway-bridge.js — no HTTP registration or deployment wiring.
- tests/billing-synthetic-gateway-bridge.test.js — SQLite in-memory tests with a fake gateway.
- migrations/0014_billing_invoice_reference_guard.sql — requires a reference
  from an invoice to be bound to the exact pending order BEFORE a synthetic
  payment verification event may credit it.
- migrations/0013_billing_foundation.sql — unchanged base migration, still
  **not applied to production**.

## Authenticated customer identity and FX quote

The local test resolves the existing BOR AI sessions schema with the same
SHA-256 session-token hash and expiry rule (epoch seconds) that its main Worker
uses. The authenticated users.id, never a userId from the body, owns both
the immutable billing quote and order. Cross-user read, retry or ownership
changes are rejected.

The server-only policyForSku() fixture picks the approved-facing USD prices
Basic $1.99 and Pro $6.99, but **all included credit amounts and payment
tariffs are placeholders**. The fixture supplies a synthetic FX source and
explicit gateway, tax, AI budget, FX/refund reserve and margin assumptions.
The customer cannot choose a USD price or modify the stored IDR quote.
One quote creates at most one order before its expiry; after an ambiguous
invoice failure the same ID is never automatically reissued.

All quote, order and ledger data are persisted to in-memory SQLite. A
production FX lock will need a reviewed server-managed rate source, time
validation at invoice creation, transaction recovery and hard IDR provider
amount check; these are still launch gates.

## Duitku-like callback and reconciliation checks

Fake gateway uses merchant DS... and HMAC-SHA256 matching the current V2
Duitku callback/signature recipe. A callback is rejected if its signature,
merchant, amount, invoice reference, parameter multiplicity or order ID fails.
Passing a signed callback is **not** enough for a credit grant.

The simulated server-to-server transaction-status response must have the
same order ID, stored reference, exact IDR amount, IDR currency and status
00 for paid. A browser redirect or callback resultCode does not authorize
settlement, and pending/failed provider responses never grant credits.

Verified synthetic events use an immutable SQL ledger and unique event/order
constraints; repeated or concurrent callbacks must leave one credit grant.

This is NOT an implementation of a live Duitku invoice provider. The
existing isolated Duitku Worker supports only a fixed Rp10,000 / 100-test-
credit invoice in its own D1; **do not link it to Basic, Pro or real user
balances**. The fake provider response has an explicit currency field,
which the real Duitku transaction-status response does not; a real adapter
must establish currency/merchant via validated server-owned configuration
and order data. Consult official V2 status documentation before implementing.

## Refund / chargeback

The operator-only offline reversal simulator requires a separate injected
operator-authorization function and a trusted mock provider receipt of a
FULL refund or chargeback with order ID, reference, IDR amount and event
type matching the original paid invoice. It never requests that Duitku
transfer money to a customer.

The SQL state machine creates an append-only negative-credit entry after
verification, without deleting the earlier grant. If refunded credits were
already spent, a debt projection blocks further debits; a later grant repays
debt before becoming spendable. Duplicates are harmless, and a terminal
chargeback cannot be changed to a refund.

Partial refunds and real-money payouts **are not implemented**. The V2
transaction-status API by itself is not established as proof of successful
refund settlement; before production, verify Duitku's actual refund,
dispute and channel-specific status process, including evidence retention,
operator permissions and customer notice.

## Tests and gates

The tests exercise authentication, expired/cross-account sessions, FX/order
immutability, provider invoice timeout, duplicate checkout, forged callbacks,
independent provider confirmation, 12 concurrent signed callbacks, full
refund after usage, debt freeze, chargeback exclusivity, append-only history,
and an injected ledger failure proving atomic rollback.

No migration is automatically applied. Do not enable production D1 migration
deployment or billing features based on these tests alone. Before real
checkout: verify signed callback and provider status against a new
customer-specific SANDBOX project (not the fixed proof Worker), actual
payment channel fees, FX source, pricing allocations, refund rules,
per-user authorization, production fraud review, reconciliation/rollback,
and explicit owner go-live approval.

Focused test: node --test tests/billing-synthetic-gateway-bridge.test.js

Official documentation: https://docs.duitku.com/api/en/

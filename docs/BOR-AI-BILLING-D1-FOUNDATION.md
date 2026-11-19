# BOR AI billing D1 foundation — NOT enabled for customer payments

**Status: synthetic-only, feature not deployed, no real customer credit grants.**
This milestone creates a reviewable future billing schema and a backend-only
simulation API. It deliberately adds **no HTTP route**, no Duitku provider
adapter, no new Worker bindings, no actual refund API, no production wallet
entitlements and no automatic database migrations.

## Migration and isolation

- SQL: migrations/0013_billing_foundation.sql
- Logic: src/billing-ledger-foundation.js
- Tests: tests/billing-ledger-foundation.test.js
- Existing signed-in identity: users.id from migration 0001.
- All billing ledger and wallet tables are independent from daily_usage,
  image_wallets, image_credit_ledger and the isolated Duitku Sandbox D1.
- Foreign keys use ON DELETE RESTRICT to protect financial/audit history.
  Future account-erasure compliance must establish legal retention and
  pseudonymization policy before this migration is deployed to real users.
- The existing production deploy workflow requires an explicit
  apply_db_migrations input, default false; merging this file alone does
  not migrate the production D1. Do **not** enable that input for this
  migration until policy and review gates are complete.

## FX lock

createSyntheticBillingQuote() computes from previewBillingQuote() and saves:
* authenticated user ID (never from untrusted browser data);
* fixed Basic USD 1.99 or Pro USD 6.99, or explicitly configured top-up USD price;
* provisional credit amount and tariff version, **not yet approved entitlements**;
* exact FX rate (micro-IDR per USD), source, issued/expiry (at most 15 minutes);
* rounded-up integer IDR quoted amount, gateway method/fee and fee source;
* gateway fee tax, provider budget, FX/refund reserves, other costs,
  contribution and minimum required contribution.

SQLite triggers prohibit any update/delete to quotes. One quote may produce
one pending order only, which must belong to the same user and be created
before the snapshot expires (server timestamps). Repeating the same quote ID
with changed rate or owner fails. Replaying the same order returns the original
order without creating a second invoice.

**This is a durable synthetic quote snapshot, not a production FX rate lock.**
An actual checkout requires an approved live FX source and merchant terms,
a server-generated quote ID, authenticated owner, secure account binding,
Duitku invoice creation, webhook reconciliation and IDR verification.

## Exactly-once ledger and refunds

billing_payment_events accepts only verification_mode='synthetic_test'
at the SQL level. No provider proof can be supplied through an HTTP route.
A future signed callback/status adapter requires independent review and a
separate migration before it can insert authoritative financial events.

The synthetic event state machine is:
pending --(payment_verified)--> paid
paid --(refund_verified)--> refunded
paid --(chargeback_verified)--> chargeback

The amount must exactly equal the persisted IDR quote; refund and
chargeback must also reuse the original provider reference. Event keys,
reference/type and order/type are unique. Triggers perform state transition,
one-time credit issuance/reversal and wallet projection atomically.
Paid, refunded and chargeback have no unverified backward transition.

billing_credit_ledger is append-only, with unique source identifiers and
individual usage debits. The wallet projection tracks:
- available_credits: spendable, nonnegative;
- debt_credits: credit debt created if a provider-verified full refund or
  chargeback removes credits that the user has already consumed;
- a future grant reduces debt first, then increases available credits;
- new usage cannot occur while debt exists.

The refund/chargeback path **does not send money to a bank or card**.
It models the credit-side reversal AFTER a trustworthy provider refund
or chargeback has been independently verified. Partial refunds, grace
periods, mixed entitlements, dispute appeals and billing redemptions
are not implemented; this milestone supports full-credit clawback only.
Never make a customer-facing promise of automatic refunds from this code.

Financial audit API getBillingWalletAudit() checks available - debt against
SUM(ledger.delta) without modifying balances. No read/write HTTP API is
wired until authentication, privacy and account ownership are audited.

## Security limitations and release requirements

- This is an in-memory/D1-compatible synthetic test model. A privileged
  SQL caller could forge verification flags or modify the wallet projection:
  **do not expose the synthetic event writer directly to customer input.**
- No live money moves, no production ledger migration, no live checkout,
  no subscription renewal or rollover, no credit debit for real AI calls.
- No actual source-of-truth provider signature/status verification or event
  synchronization is connected. All synthetic events are test-only.
- No recorded merchant fee contract, FX live feed or approved top-up/credit
  tariff. Plan USD prices are approved for planning only.
- Production requires threat-model review, D1 Time Travel rollback
  bookmark, tenant authorization, real gateway verification and fraud
  controls, all refund paths, ledger audit/reconciliation at scale, and
  explicit owner authorization.
- Future billing schema migration must not be executed on the separate
  Duitku Sandbox database or assumed to reuse its fixed 100 test credits.

Local automated test:
  node --test tests/billing-ledger-foundation.test.js

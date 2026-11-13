# BOR AI — subscription, credit and payment architecture (draft, no launch authorization)

Status: DESIGN ONLY. No checkout, paid API, migration or billing is enabled by this document.

## Existing implementation (verified against main)

- Chat currently uses daily **quota units**, not measured tokens: ordinary request = 1 unit, multi-agent = 3 units (`src/daily-limits.js`).
- Current default per UTC day: guest 15, signed-in user 150, global 1500. These limits protect current usage but **are not paid credits or USD costs**.
- D1 `daily_usage` counters exist. Do not reinterpret or migrate these counters as financial balances.
- Workers AI baseline model catalog has **unknown** input/output token rates (`src/model-gateway.js`). Do not publish profitability estimates until pricing and actual token metering are verified.
- URL Reader remains OFF. Tavily Extract needs separate provider security/privacy/billing sign-off.

## Product proposal (not yet approved prices)

- Main accounting, invoices, entitlements and financial reports in **USD**.
- Indonesian checkout may accept IDR through a payment gateway supporting local bank transfer, QRIS and e-wallets. Display an exchange-rate quote, FX source, fees and expiration; lock the exact IDR amount in the server-side order at checkout. Do not infer payment success from a browser redirect.
- Candidate tiers: Basic **$1.99/month** and Pro **$6.99/month**; these are hypotheses, not validated unit economics. Optional credit top-ups priced in USD; no unlimited usage promises.
- Keep guest/free protections separate from subscription allowances. Define a consistent paid unit, e.g. internal **microcredits** as integer ledger amounts; token usage and external tool charges map to microcredits via a versioned rate table. Never equate 1 message with 1 token.
- No plan or payment activation before end-to-end reconciliation, refunds, tax, chargeback, fraud, privacy and provider costs are reviewed.

## Financial and metering invariants

1. Every inference records model/provider, request ID, input/output tokens if reliably reported, measured-vs-estimated flag, unit-rate version, provider cost USD, customer debit microcredits and UTC timestamp. Unknown cost is not treated as zero.
2. Store USD money as integer **micro-USD** (1 USD = 1,000,000 micro-USD), IDR as integer rupiah, credits as integers; never use floating point for ledger arithmetic.
3. Distinguish **provider cost** from **customer credits**; rate changes affect future usage only. Provider costs, processing fees, taxes, FX spread, chargebacks and refunds all affect contribution margin.
4. Debit credits atomically in D1 using a unique idempotency key per request. Retry/replay must not debit twice. Reserve a bounded maximum before calling a paid provider, then settle measured usage and release unused reservation. If quota storage fails, refuse billable requests.
5. A subscription renewal or top-up grants credits **only** after a server-verified, signature-validated payment event and an authoritative provider status lookup. Unique payment-event ID and order ID prevent double grants.
6. Ledger is append-only with compensating entries for refunds/chargebacks/adjustments. Keep a separate balance projection and reconciliation job. Do not edit financial ledger history.
7. Hard ceilings: per-user credit balance, per-request max spend, per-day provider budget, global spend ceiling, rate limits and an emergency kill switch. A daily request count is not a USD-denominated spend cap.
8. Webhook handling must authenticate, validate currency/amount/order/customer, handle out-of-order events and prevent replay. Never expose payment secrets in client code or logs.
9. Store a USD price snapshot, IDR quote, FX rate/source/expiry, provider fee and currency on every order. Confirm Indonesian payment methods and legal/tax obligations with the actual provider before release.
10. Treat failed provider calls, retries, timeout and partially generated output explicitly; define customer refund policy separately from whether upstream charges were incurred.

## Proposed data entities (future migrations only)

- `plans`: plan ID, USD price micro-units, billing period, included credit grant, rate version, status.
- `subscriptions`: user ID, provider subscription ID, state, period start/end, grace/renewal and cancellation state.
- `orders`: user, type, USD price snapshot, IDR quote, FX source/rate/expiry, gateway reference, state.
- `payment_events`: unique gateway event ID, order ID, validated event type, processing state.
- `credit_ledger`: immutable unique transaction ID, user, delta microcredits, cause, reference, created time.
- `credit_reservations`: unique chat request ID, max debit, actual debit, state and expiry.
- `provider_usage`: request ID, provider/model, token counts, measured flag, rate version, cost micro-USD.
- `pricing_versions`: provider rate snapshots and customer conversion policies, effective timestamps.
- `reconciliation_runs`: provider payout, gateway settlement and ledger mismatch audit results.

## Unit economics: formula, not invented estimates

`gross revenue USD = subscription revenue + top-ups`

`contribution margin USD = revenue - actual AI provider costs - search/extract costs - payment fees - FX costs - refunds/chargebacks - other variable costs`

`gross margin % = contribution margin / revenue * 100` (when revenue > 0).

For each tier, run conservative/base/stress scenarios from **verified** provider rates, real token counts per request, multi-agent amplification, utilization distribution, gateway pricing and FX. Do not treat the $1.99/$6.99 candidates as profitable until these are measured.

## Safe implementation sequence

1. Collect verified Workers AI model pricing, token usage telemetry, provider limits, payment gateway fee schedules and Indonesia checkout requirements. Confirm user-facing credits and expiry/refund terms.
2. Add **feature-flagged**, migration-reviewed D1 schema and read-only balance/usage APIs, with ledger and idempotency tests. Keep all paid features disabled.
3. Implement atomic reservation/settlement and spend ceilings; test concurrency, retry, timeout, rollback and fail-closed behavior with mocked providers.
4. Implement payment order creation and signed webhooks in **sandbox**; test duplicate/out-of-order events, invalid signatures, incorrect amount/currency and refund/chargeback reconciliation.
5. Conduct staging simulations and financial reconciliation; security/privacy review; explicit owner approval before any production payments or live paid calls.

## Launch gates

- Provider costs and token accounting verified; worst-case unit economics approved.
- Payment provider, supported methods, FX, fees, settlement, refund and tax policy verified.
- No missing migrations; backups/rollback and reconciliation evidence recorded.
- Paid API usage caps enforceable and tested, with customer-facing transparent balances.
- Security, privacy, webhook and fraud controls independently reviewed.
- Explicit owner sign-off for production checkout and subscription activation.

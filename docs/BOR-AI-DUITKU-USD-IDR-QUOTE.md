# BOR AI — USD/IDR billing quote preview (offline, disabled)

**Status: PROPOSAL ONLY.** The new pure module src/billing-quote-core.js is NOT wired into a Worker route, subscription, wallet, invoice, gateway API or live FX source. It cannot create or pay orders. It is not a live USD-to-IDR checkout lock.

User-approved USD-facing plan prices:
- Basic: USD 1.99 per month.
- Pro: USD 6.99 per month.

The example credit allocations (Basic 3,000, Pro 15,000) come from the *unapproved* evaluation scenario, not customer entitlements. The number 100 credits in the recent Duitku Rp10,000 Sandbox proof is strictly simulation, not a commercial exchange rate. Top-up USD prices and credits remain unapproved; the function requires them explicitly, and there is no customer-facing top-up SKU.

## What the module proves

- Exact integer USD micro-unit arithmetic and ceiling IDR conversion; no floating money.
- Explicit FX snapshot source, rate, start and maximum 15-minute preview expiry.
- Explicit Duitku merchant fee, fee-tax, provider budget, FX/refund reserves, variable costs and required contribution-margin screen. Zero values are only allowed if consciously supplied, never invented from absent inputs.
- Examples with illustrative FX and fees. Actual merchant fees, whether a fee is merchant/customer borne, refund terms, and effective tax must be checked against the actual Duitku agreement and fee configuration.
- All outputs have launchEligible=false, checkoutEnabled=false, realCreditsGranted=false. A passing margin screen is NOT approval to launch.
- Prevents changing the Basic or Pro USD price through a request parameter. Top-up price must be configured separately.
- The field lockedIdrPreview is a *value snapshot only*, not a durable order. A proper lock requires server-owned quote ID, persisted FX source/rate/expiry, customer identity, tamper protection, expiry checking at payment creation, gateway fee reconciliation and amount verification.

## Production gates still open

1. Confirm and version current provider cost tariffs (model tokens, Tavily searches/Extract, image AI, platform costs), approved credit allocation, realistic usage, and minimum safe margins.
2. Obtain actual Duitku merchant fees, tax handling, chargeback/refund policy, supported channel limits, and determine who bears gateway costs. Published pricing is not a substitute for a signed merchant agreement. See https://www.duitku.com/harga/ and https://docs.duitku.com/api/id/.
3. Implement a feature-flagged customer-owned D1 schema for orders, invoice events, subscription periods and unique append-only credit ledger; do not reuse the isolated fixed Rp10k Sandbox ledger.
4. Persist server-authored FX snapshots and USD prices; reject expired or altered IDR quotes. Only grant credits after verified server-to-server callback plus authoritative Duitku status lookup; test duplicate/out-of-order callbacks, concurrency, refunds, cross-user replay and fail-closed errors.
5. Run sandbox and security/finance review. Explicit founder authorization is still required before enabling production payments.

To run focused tests: node --test tests/billing-quote-core.test.js.

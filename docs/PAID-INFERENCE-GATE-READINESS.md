# BOR AI — paid inference reservation gate (NOT ACTIVATED)

Updated: 2026-11-15. This is a development-only component on PR #245. It is **not** wired into production chat, Telegram, public API or any other user-facing route. The pricing parameters in tests are synthetic, not an approved product price or promise.

## What is implemented

`src/billable-inference-gate.js` composes the draft D1 credit ledger reservation/finalization in `src/credit-ledger.js` with `src/credit-metering.js` token-cost arithmetic. The behavior is tested with actual in-memory SQLite triggers (not D1 remote production) and synthetic provider responses.

- Requires a **server-approved versioned tariff** with integer input/output token rates, integer credit conversion ratio, a per-call USD ceiling and a per-call credit ceiling. Any missing rate or unapproved tariff fails before inference.
- Reserves **maximum potential** USD cost using the explicitly permitted model context and output caps before any model call; the model caller must independently enforce these caps, including the actual `max_tokens` parameter.
- Requires a **separate atomic provider budget dependency** before the customer wallet reservation. A development-only D1 implementation now exists in `src/provider-spend-budget.js` and `migrations/0013_provider_spend_budget.sql`: it enforces a provider-specific and cross-provider `__global__` daily cap using one atomic SQLite statement. Both trusted operator-provisioned limit rows are mandatory; without them the gate fails closed. It is not applied to production.
- Requires an authenticated user ID, a unique server-verified request ID and a D1 adapter. Duplicate requests must never trigger additional paid model invocations.
- After a call, accepts only complete integer measured token usage, with matching aliases if present. Computes provider cost and customer debit from the approved tariff and checked limits; never maps a message count to token cost.
- Holds the reservation (without declaring a successful charge or exposing a paid answer) if provider outcome is unknown, token usage is missing/inconsistent, the measured total exceeds caps or settlement fails.
- On successful settlement, returns actual provider cost, customer debit, policy version and the AI result. This single-call guard is **not** a multi-agent billing integration.

## Additional verification: 15 November 2026

- [Isolated Wrangler local D1 billing proof — run 43704785853](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43704785853) passed using a fresh temporary D1 instance via Wrangler `--local`. It exercises both proposed migrations, reservation, measured synthetic settlement, duplicate rejection, cross-provider spending caps, failed-reservation rollback and prevention of a double credit refund.
- `.github/workflows/bor-ai-isolated-billing-d1.yml` uses no Cloudflare credentials, no `--remote`, no production database binding and no persistent customer data. The local state is discarded after the run. **This is local D1, not a remote disposable D1 concurrency test.**
- `src/billing-reconciliation.js` provides a **read-only, transactional D1-batch snapshot** of stalled reservations, mismatched budget counters, missing provider caps, wallet journal discrepancies and caps exceeded. Reports contain aggregate counts only, no customer identifiers or request contents. No automatic refund/release is performed.
- Aggregate reconciliation **does not verify Cloudflare invoices, source usage authenticity, package margin, foreign exchange or refund legality**; it cannot substitute provider-ledger reconciliation or a named financial/security signoff. Held reservations require explicit, independently evidenced resolution.

## Release blockers — all must be closed separately

1. **Authoritative token accounting:** verify the actual `env.AI.run` response usage shape and billing for the configured model with a bounded staging request; compare Cloudflare invoice/dashboard readings. The public model documentation mentions `usage` but does not guarantee every response provides complete counters. Unknown usage stays fail-closed. Provider errors or timeouts might still incur charges.
2. **Atomic global spend enforcement:** local SQLite tests now exercise D1-style per-provider and global budget reservations, settlement, duplicate IDs and concurrency. Still required: disposable remote D1 stress testing, a durable alerting/kill switch, safe lifecycle for unknown/expired holds, operator-approved caps and recovery from settlement failures. Do not substitute request-count quotas or an in-memory counter.
3. **Approved credit tariff and margin model:** record genuine Cloudflare Workers AI rates, measured token distributions, multi-agent/retry amplification, Tavily charges, payment fees, taxes and refunds; obtain owner approval. The test fixture values and `approved:true` flag are not launch approval.
4. **Safe input/output caps:** wire at the actual `env.AI.run` boundary, including every sub-agent, retry, Telegram/public API call and explicit `max_tokens`. Reject bypass paths; enforce model context and any provider/tool costs. One reservation protects only one call.
5. **Provider usage journal and reconciliation:** store per-attempt measured-vs-unknown token counts, rate versions, micro-USD costs and structured failure codes without raw prompts. Reconcile held reservations, timeouts, retried calls, late provider usage, refunds and chargebacks. The returned in-memory result is **not** a durable cost journal.
6. **D1 and security validation:** execute remote disposable-D1 concurrency tests and failure injection for the actual gate, benchmark high-concurrency charging, authenticate clients server-side, test caller cancellation, rollout/rollback and independent privacy review. No production migration or paid activation before signoff.

## Integration sequence

1. Keep current production quota-unit limits and URL Reader OFF.
2. Independently review the ledger and provider-spend SQL migrations, configure operator-owned caps for each day/provider and `__global__`, and test the combined integration on disposable remote D1 before any rollout.
3. Inject actual server-controlled tariff, verified identity and idempotency key into the gate at every model call boundary in a staging-only deployment.
4. Verify real token usage and reconcile every staging test across provider usage, daily budget and user credit journal.
5. Explicit owner approval for pricing, migration and controlled production checkout after Midtrans activation.

The gate is **a safety prototype, not a claim that BOR AI can charge real customers today**. On failures, reserve holds need operational reconciliation; do not auto-refund merely because a provider response is missing.

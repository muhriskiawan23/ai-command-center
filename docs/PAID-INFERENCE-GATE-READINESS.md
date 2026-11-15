# BOR AI — paid inference reservation gate (NOT ACTIVATED)

Updated: 2026-11-15. This is a development-only component on PR #245. It is **not** wired into production chat, Telegram, public API or any other user-facing route. The pricing parameters in tests are synthetic, not an approved product price or promise.

## What is implemented

`src/billable-inference-gate.js` composes the draft D1 credit ledger reservation/finalization in `src/credit-ledger.js` with `src/credit-metering.js` token-cost arithmetic. The behavior is tested with actual in-memory SQLite triggers (not D1 remote production) and synthetic provider responses.

- Requires a **server-approved versioned tariff** with integer input/output token rates, integer credit conversion ratio, a per-call USD ceiling and a per-call credit ceiling. Any missing rate or unapproved tariff fails before inference.
- Reserves **maximum potential** USD cost using the explicitly permitted model context and output caps before any model call; the model caller must independently enforce these caps, including the actual `max_tokens` parameter.
- Requires a **separate atomic provider budget dependency** before the customer wallet reservation. This daily/global budget implementation **does not yet exist**; without it the gate cannot run.
- Requires an authenticated user ID, a unique server-verified request ID and a D1 adapter. Duplicate requests must never trigger additional paid model invocations.
- After a call, accepts only complete integer measured token usage, with matching aliases if present. Computes provider cost and customer debit from the approved tariff and checked limits; never maps a message count to token cost.
- Holds the reservation (without declaring a successful charge or exposing a paid answer) if provider outcome is unknown, token usage is missing/inconsistent, the measured total exceeds caps or settlement fails.
- On successful settlement, returns actual provider cost, customer debit, policy version and the AI result. This single-call guard is **not** a multi-agent billing integration.

## Release blockers — all must be closed separately

1. **Authoritative token accounting:** verify the actual `env.AI.run` response usage shape and billing for the configured model with a bounded staging request; compare Cloudflare invoice/dashboard readings. The public model documentation mentions `usage` but does not guarantee every response provides complete counters. Unknown usage stays fail-closed. Provider errors or timeouts might still incur charges.
2. **Atomic global spend enforcement:** implement and test D1-backed daily/provider-wide budget reservations with idempotent settle/expiry, concurrent requests and a hardened emergency kill switch. Do not substitute request-count quotas or an in-memory counter.
3. **Approved credit tariff and margin model:** record genuine Cloudflare Workers AI rates, measured token distributions, multi-agent/retry amplification, Tavily charges, payment fees, taxes and refunds; obtain owner approval. The test fixture values and `approved:true` flag are not launch approval.
4. **Safe input/output caps:** wire at the actual `env.AI.run` boundary, including every sub-agent, retry, Telegram/public API call and explicit `max_tokens`. Reject bypass paths; enforce model context and any provider/tool costs. One reservation protects only one call.
5. **Provider usage journal and reconciliation:** store per-attempt measured-vs-unknown token counts, rate versions, micro-USD costs and structured failure codes without raw prompts. Reconcile held reservations, timeouts, retried calls, late provider usage, refunds and chargebacks. The returned in-memory result is **not** a durable cost journal.
6. **D1 and security validation:** execute remote disposable-D1 concurrency tests and failure injection for the actual gate, benchmark high-concurrency charging, authenticate clients server-side, test caller cancellation, rollout/rollback and independent privacy review. No production migration or paid activation before signoff.

## Integration sequence

1. Keep current production quota-unit limits and URL Reader OFF.
2. Finish the separate approved monetary ledger and global provider-spend budget.
3. Inject actual server-controlled tariff, verified identity and idempotency key into the gate at every model call boundary in a staging-only deployment.
4. Verify real token usage and reconcile every staging test across provider usage, daily budget and user credit journal.
5. Explicit owner approval for pricing, migration and controlled production checkout after Midtrans activation.

The gate is **a safety prototype, not a claim that BOR AI can charge real customers today**. On failures, reserve holds need operational reconciliation; do not auto-refund merely because a provider response is missing.

# BOR AI — Free daily-unit cost exposure (offline, no quota change)

**Status:** illustrative financial-risk study only, 17 November 2026. Not observed provider billing, a guaranteed spending ceiling, or approval to change Free/paid plans. No live provider calls, payments, credits, D1 migrations or deployment.

## Inputs

The test reads daily counters from `src/daily-limits.js` and synthetic model/search prices from the offline `evaluation/bor-ai-credit-scenarios.js` module. Environment overrides can make live limits different from source defaults.

- Guest **15 units/day**; signed-in user **150/day**; app-wide shared cap **1,500/day**. Ordinary chat 1 unit, multi-agent 3 units. Reset at 07:00 WIB. Units are **not** paid credits or tokens.
- Example ordinary chat: **one Cloudflare model call** at 2,000 input and 500 output tokens = **1,713 micro-USD**, with upward micro-USD rounding.
- Example multi-agent: **two identical model calls plus one hypothetical Tavily basic search credit** = **11,426 micro-USD**. This is not a claim that all actual multi-agent executions have exactly two calls or use Tavily.
- 30-day illustrative period; Basic US$1.99 and Pro US$6.99 approved USD list prices, but **paid credit grants remain a proposal, not a live entitlement**.
- No assumption of free model subsidy, real invoice usage, retry cost, merchant fees, or actual user mix.

## Fixed-price scenario results, *not actual spend or true maximum bill*

| Scope (illustrative full daily usage) | 30-day synthetic provider cost |
| --- | ---: |
| One signed-in Free user — 150 ordinary requests/day | **US$7.7085** |
| One signed-in Free user — 50 multi-agent requests/day | **US$17.1390** |
| One Guest — 5 multi-agent requests/day | **US$1.7139** |
| App-wide 1,500 units/day — 500 multi-agent requests/day | **US$171.3900** |

The model chooses the higher cost of (1) all ordinary requests or (2) the most multi-agent requests possible, with remaining ordinary units. The global limit is *shared* and means unlimited users cannot simultaneously consume the individual worst-case volume. In real operation, model response size and per-call count vary, so a unit quota is **not a guaranteed USD spend cap**.

## What must be done before paid launch

1. Measure real model call input/output tokens and all extra calls, failures, retries and search requests, then reconcile with actual provider billing.
2. Create independently enforceable per-user and global **USD spend limits**; do not treat quotas, Worker free allocations or illustrative costs as certain.
3. Reconcile paid-vs-Free value: paid monthly credits are an unapproved hypothesis; 150 daily Free units may currently dilute the value of Basic. Do **not** silently reduce Free quotas without founder approval.
4. Include abuse/spend alerts, user-impact evaluation and commercial messaging before quota policy changes.
5. Hold commercial launch until financial and security gates on issue #253 and payment approval are satisfied.

Implementation: `evaluation/free-tier-usage-exposure.js`, regression tests: `tests/free-tier-usage-exposure.test.js`. The test uses BigInt micro-USD, explicit synthetic scenario input and rejects missing prices or overflow.

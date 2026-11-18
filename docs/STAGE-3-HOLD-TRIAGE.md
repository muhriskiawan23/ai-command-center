# BOR AI Stage 3 — operator hold triage (inactive, read-only)

Status: **staging prototype; NO LIVE SETTLEMENT, NO PRODUCTION D1 MIGRATION**. Requires complete finance/security review and founder release approval. Part of Draft PR #255 and issue #253.

## Why it matters

A Workers AI request can be dispatched successfully but then time out, return incomplete token usage, or fail while finalizing either the provider budget or customer wallet. Never auto-refund an uncertain upstream cost or auto-charge a user based on an unverified guess.

`src/stage3-hold-triage.js` provides one **read-only aggregate SQL SELECT** over the existing, **unapplied** Stage 2/3 tables. It differentiates:
- A stale provider hold with or without wallet reservation
- A stale dual hold before confirmed dispatch
- A stale dispatch with no outcome event for that attempt, including when another attempt in the same request has measured usage
- A dispatched provider with unknown outcome or unverified usage
- Measured usage but provider budget still reserved
- Provider budget settled but wallet not finalized
- Wallet finalized/released while provider budget remains reserved
- Provider spending settled without a measured journal event
- Customer wallet marked settled without any measured journal event (including a provider zero-cost settlement)
- Provider spending whose amount disagrees with summed measured journal costs
- Orphan wallet holds, provider budget holds, and dispatch journals

The report contains only counts, cutoff timestamp, and review status, **no customer IDs, request IDs, prompts, response bodies, raw tokens, payment details, or per-user financial balances**. `providerInvoiceVerified` remains explicitly `false`, even for a clean report.

## Safe operator workflow (not implemented as a mutation)

1. Collect authoritative provider usage/invoice evidence and the individual immutable journal events through a separately approved, access-controlled operator tool.
2. Check the account owner, provider, model, rate version, full retry chain, gateway/ledger order ID, actual cost, and request state against provider invoices. Do not infer zero cost from a timeout.
3. Only after documented independent signoff, build narrowly scoped **idempotent** operator reconciliation actions that atomically record compensating adjustments. Neither this report nor its tests execute such actions.
4. On any mismatch, fail closed and continue holding disputed reservations pending human resolution.
5. Run isolated local and fresh remote disposable D1 proofs before production consideration. Existing Stage 2 remote sandbox D1 is populated and must not be reset or reused for a fresh-db proof.

## Evidence

`tests/stage3-hold-triage.test.js` uses real in-memory SQLite with unapplied migrations `0012`, `0013`, `0014`, and current ledger, budget, journal adapter APIs. Covers clean settlement, unknown outcomes, pre-dispatch holds, measured-but-unsettled, mismatched provider costs, orphan journals and invalid-state rejection. All monetary values in fixtures are synthetic.

**Caveats:** Counts alone cannot validate Cloudflare invoices or prove a settlement was authorized. Cross-provider retry accounting and crash recovery require separate integration tests. The read-only report is a triage aid, not a go-live decision.


## Per-attempt provider deadline and unknown-cost recovery — 18 November 2026
In the unmerged PR #264 Stage 3 orchestrator, every independently journaled
model attempt now has an explicit **bounded** timeout:
`modelTimeoutMs` defaults to 30,000 ms and accepts only integer values
between 1 and 60,000 ms. Validation occurs before any provider budget
or customer credit reservation. The AI callback receives an
`AbortSignal` and its pending outcome is raced against the server-side
deadline. Even an uncooperative callback that ignores abort cannot
keep the request pending indefinitely **at the model-call step**.

If the deadline expires, the orchestrator appends an immutable
`outcome_unknown` event when D1 is available, refuses to deliver the
model output, and **keeps the wallet and provider-budget reservations**
for operator review. It cannot assume a timed-out attempt costs $0.
A late success or failure is not promoted to measured usage, cannot
trigger a second settlement, and is never returned to a customer.
A duplicate logical request remains denied by the existing atomic
budget and wallet request-ID keys; retries require a separate,
server-issued attempt identifier and approved worst-case accounting.
The isolated staging Worker has a `provider-timeout` injection option
that uses a **never-resolving fake provider** and a 25 ms deadline to
test this behavior end-to-end with disposable local D1.

**Limitation:** this is an in-process per-model timeout. It is not a
global bound on D1 reservation, journal writes, the entire request, the
provider's *actual* billing window, or crash/restart recovery. A worker
may terminate before writing the unknown event; the existing stale
dispatch detector must then require a separate operator investigation.
Neither a successful timeout test nor a provider-statement arithmetic
match proves actual invoice costs. No live model call, real payment,
automatic refund, production migration, deploy, or release approval.

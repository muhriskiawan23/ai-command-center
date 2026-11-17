# BOR AI Stage 3 — operator hold triage (inactive, read-only)

Status: **staging prototype; NO LIVE SETTLEMENT, NO PRODUCTION D1 MIGRATION**. Requires complete finance/security review and founder release approval. Part of Draft PR #255 and issue #253.

## Why it matters

A Workers AI request can be dispatched successfully but then time out, return incomplete token usage, or fail while finalizing either the provider budget or customer wallet. Never auto-refund an uncertain upstream cost or auto-charge a user based on an unverified guess.

`src/stage3-hold-triage.js` provides one **read-only aggregate SQL SELECT** over the existing, **unapplied** Stage 2/3 tables. It differentiates:
- A stale provider hold with or without wallet reservation
- A stale dual hold before confirmed dispatch
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

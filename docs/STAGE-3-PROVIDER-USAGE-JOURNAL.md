# BOR AI — Stage 3 provider usage audit journal (development-only)

**Status: INACTIVE PROTOTYPE / NOT MERGED / NOT LINKED TO ROUTES.**

Stage 2 remote D1 concurrency proof passed on [run #44003354049](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44003354049) on 17 November 2026. That was synthetic financial-invariant testing only, not authentic Workers AI cost verification.

This Stage 3 proposal adds:
- `migrations/0014_provider_usage_journal.sql`: **UNAPPLIED** append-only `provider_usage_events` with an immutable dispatch record, optionally followed by an unknown/unverified outcome, and a measured-cost event after trusted usage becomes available. The trigger requires exact matching attempt/request/provider/model/tariff version and prevents changing past events.
- `src/provider-usage-journal.js`: an **opt-in internal** function `appendProviderUsageEvent()` for a server-issued opaque attempt ID. A measured event requires a caller-provided *server-approved and version-matched* tariff and complete, internally consistent token counts. Integer micro-USD provider cost is calculated independently. Incomplete counts cannot be treated as zero cost; failed journal inserts return `ok:false`. A separate read-only aggregate `inspectProviderUsageJournal()` returns counts and unresolved attempts with no customer IDs.
- `tests/provider-usage-journal.test.js`: real SQLite constraints, replay, missing dispatch, mismatched references, unknown-outcome retention, later reconciliation, rate mismatch, inconsistent provider token usage, immutable history, cost-overflow guard, missing table fail-closed and private metadata checks.

## Intended integration (NOT IMPLEMENTED)

Before a paid model call, a future staging-only gate MUST atomically reserve global/provider budget and customer credits and durably append a `dispatched` record, refusing provider dispatch if the record is not confirmed. After the call it MUST append a measured or unknown/unverified event, reconcile the authoritative provider usage/invoice and commit both financial settlements in a documented sequence. Every model call, retry and agent/tool invocation needs its **own attempt ID**. The existing prototype `runReservedBillableInference` is **not wired** to this journal yet, and adding a journal by itself does not close the settlement-crash atomicity window.

## Safety and privacy

- No migrations against production or the Stage 2 disposable remote test DB.
- No real payment, Workers AI, Tavily, Midtrans or external API calls.
- No prompt, output, auth token, email address, provider payload or customer identity stored. Identifiers must be server-issued random opaque references and are still subject to retention and access-control review.
- An "unknown" event cannot be claimed to cost zero; a later trusted measured event may resolve it without rewriting history.
- `approved:true` in a synthetic test fixture is **not** tariff approval for real customers. The source, price, metering and owner decisions must be independently verified and versioned.
- This report does **not** prove provider billing or invoice correctness and cannot authorize Stage 3 production.

## Remaining gates

Authoritative response metering at the configured model, actual provider invoice comparison, owner-approved rates/credit conversion and global caps, durable reconciliation and alerts/kill switch, staging-only endpoint integration, independent security/privacy review, Midtrans lifecycle verification and a separately authorized production migration/release.

Tracked in [Stage 3 issue #253](https://github.com/muhriskiawan23/ai-command-center/issues/253) and [Stage 2 PR #245](https://github.com/muhriskiawan23/ai-command-center/pull/245). Preserve production quota controls and keep URL Reader off.

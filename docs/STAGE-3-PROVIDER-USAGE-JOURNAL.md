# BOR AI — Stage 3 provider usage audit journal (development-only)

**Status: SYNTHETIC STAGING WORKER / NO PRODUCTION ROUTE INTEGRATION.**

Stage 2 remote D1 concurrency proof passed on [run #44003354049](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44003354049) on 17 November 2026. That was synthetic financial-invariant testing only, not authentic Workers AI cost verification.

This Stage 3 proposal adds:
- `migrations/0014_provider_usage_journal.sql`: **UNAPPLIED** append-only `provider_usage_events` with an immutable dispatch record, optionally followed by an unknown/unverified outcome, and a measured-cost event after trusted usage becomes available. The trigger requires exact matching attempt/request/provider/model/tariff version and prevents changing past events.
- `src/provider-usage-journal.js`: an **opt-in internal** function `appendProviderUsageEvent()` for a server-issued opaque attempt ID. A measured event requires a caller-provided *server-approved and version-matched* tariff and complete, internally consistent token counts. Integer micro-USD provider cost is calculated independently. Incomplete counts cannot be treated as zero cost; failed journal inserts return `ok:false`. A separate read-only aggregate `inspectProviderUsageJournal()` returns counts and unresolved attempts with no customer IDs.
- `tests/provider-usage-journal.test.js`: real SQLite constraints, replay, missing dispatch, mismatched references, unknown-outcome retention, later reconciliation, rate mismatch, inconsistent provider token usage, immutable history, cost-overflow guard, missing table fail-closed and private metadata checks.

## Stage 3 synthetic orchestration — implemented but INACTIVE

`src/stage3-journaled-inference.js` adds a **staging-only, dependency-injected**
`runJournaledInferencePrototype()`. It has no import path from production
entrypoints and no live provider credentials. Its integration tests use a **real
SQLite usage journal** plus synthetic spending/wallet adapters (not the PR #245
D1 financial ledger).

`staging/stage3-worker.js` is a separate entry point that wraps the application
Worker with the D1 budget, wallet and journal adapters. It requires the staging
operator key and a D1 binding initialized with a staging-only request claim
table. A repeated request ID is rejected before the application can dispatch a
second model call. The entry point uses a fixed synthetic wallet and model
response. It has no live AI binding and stubs Telegram delivery.

Run the workerd smoke with the existing Wrangler lockfile:

```sh
npm ci --prefix tests/billing/stage3-wrangler-lock --ignore-scripts --no-audit --no-fund
node tests/billing/stage3-staging-smoke.mjs
```

The smoke runs four application paths on disposable local D1 and checks the
settled wallet, the journal, concurrent replay, authentication, and unknown
usage holds. The [remote sandbox proof](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44102929468)
reproduced these checks on Cloudflare. It recorded seven synthetic settlements
and one hold in each ledger. The workflow disabled Worker routing after the
run. No live AI usage occurred during that proof.

The prototype demonstrates this mandatory sequence:

1. Validate a versioned server-approved tariff, conservative model input/output
   caps, customer-credit conversion and maximum USD/credit cost quote.
2. Reserve **provider and global budget first** with the supplied atomic adapter,
   then reserve customer credits with a separate atomic adapter.
3. Durably confirm an immutable `dispatched` event **before** invoking the
   injected provider. If the write is ambiguous/failed, **do not invoke or
   automatically release reserved value**; require operator reconciliation.
4. Invoke exactly one provider attempt with an independently enforceable output
   cap. A thrown call records `outcome_unknown` if possible and holds both
   reservations. Missing/contradictory usage records `usage_unverified` and
   also holds both reservations.
5. Confirm a measured usage event with independently calculated integer
   micro-USD cost **before settling either financial reservation**. Over-ceiling
   measurements remain journaled for investigation, but never authorize
   settlement or returning a paid answer.
6. Only after the journal write, settle provider budget, then customer credits.
   If either settlement fails, keep the result private and require reconciliation.
   A successful response is returned **only after both settle**.

`tests/stage3-journaled-inference.test.js` includes replay, budget denial,
insufficient wallet credit, failed dispatch/measurement writes, provider
timeout, missing/contradictory counts, measured overrun, budget-settlement
failure and customer-ledger settlement failure.

**Important limitation:** mocked adapters are *not* evidence of cross-table
atomicity or integrated Stage 2 remote D1 operations. This is independent
contract/orchestration testing. A later, separately approved patch must compose
the reviewed Stage 2 concrete `credit-ledger` and `provider-spend-budget`
adapters, add crash/restart and full remote D1 integration tests, and guarantee
server authentication and actual provider max-token enforcement at each route.
Provider `usage` fields must be checked against real provider statements and
billable costs in an explicitly approved staging test; a synthetic
`approved:true` tariff is not business/finance authorization.

The aggregate journal only counts **measured attempts**, not completed
financial settlements. The read-only Stage 2 budget+credit reconciliation and
actual provider invoice reconciliation remain mandatory before any paid release.

## Stacked local integration with actual Stage 2 adapters (Draft PR #255)

The **separate, unmerged** [stacked test PR #255](https://github.com/muhriskiawan23/ai-command-center/pull/255)
checks the combined migrations `0012`, `0013`, and `0014`
against a disposable, in-memory SQLite database. Unlike the narrower
Stage 3 orchestration fixture above, `tests/stage3-real-d1-journal-integration.test.js`
uses the actual `reserveCredits/finalizeCredits` and `providerSpendBudget`
functions on the same database as the Stage 3 append-only journal.

It verifies successful 519-micro-USD measured settlement, duplicate request
rejection, global-budget cap and insufficient-credit guard, uncertain
provider outcomes and stale reservations, failed journal persistence (no
provider call), invalid usage, failed settlements, journal and wallet
immutability and read-only billing exception reports. A separate local
parallel-request fixture tests only local SQLite budget-limit safety;
it does **not** establish remote Cloudflare D1 concurrency.

Important: PR #255 is a **combined unmerged proof branch** based on PR #245
and containing the prototype work from Draft PR #254, not an authorization
to merge all branches. Real Cloudflare D1 **remote integration** of all three
schemas, authenticated staging Worker routes, actual provider usage and
invoices, outage/retry crash recovery, privacy and independent approval
remain explicitly NOT verified. The earlier Stage 2 remote test did not
include this journal.

## Stage 3 read-only cross-ledger anomaly report (new, inactive)

The unmerged integration stack also adds `src/stage3-cross-ledger-reconciliation.js`
with a **single read-only SQLite snapshot query** that checks all three proposed
database schemas together. `inspectStage3CrossLedgerReconciliation()`
counts missing dispatched journal evidence for positive provider settlements,
actual settled micro-USD versus the sum of immutable measured usage events,
missing budget or wallet for dispatched attempts, provider/model disagreement,
stale pre-dispatch holds, measured usage with unsettled budgets, release of
customer credits despite measured usage, and multiple attempts spending one
reservation's worst-case ceiling. Its report contains only aggregate counts
and a UTC cutoff, not user IDs or raw prompts.

A successful measured-event write alone is **not** proof that both financial
reservations settled; conversely two settled ledgers can disagree with the
immutable metering journal. A missing table, incomplete result or D1 error
must refuse a clean verdict. In-flight unmeasured attempts only count as
**stale** after the configured threshold; explicit unknown/unverified outcomes
require immediate operator attention.

The follow-up safety patch also flags three **zero-cost laundering** risks:
a provider budget finalized at zero **after** a `dispatched` event,
a customer credit reservation released **after** dispatch even when usage
is still unknown, and a wallet finalized at zero despite independently
measured positive provider cost. It also flags any finalized customer
debit without a corresponding provider-budget reservation. A genuine
pre-dispatch cancellation (no `dispatched` event) is permitted to release
unused credit and settle its provider budget to zero without these anomalies.
An exception requires a human review of upstream evidence; it is not
permission to charge a customer or auto-issue a refund.

This audit is a risk detector, **not an automatic reconciliation action**.
It cannot infer the official billed token counts, reconcile actual provider
invoices, apply refunds, release uncertain reservations, change prices or
approve production activation. Versioned credit conversion and independent
invoice comparison remain separate launch gates.

## Intended production integration (NOT IMPLEMENTED)

Before a paid model call, a future staging-only gate MUST atomically reserve global/provider budget and customer credits and durably append a `dispatched` record, refusing provider dispatch if the record is not confirmed. After the call it MUST append a measured or unknown/unverified event, reconcile the authoritative provider usage/invoice and commit both financial settlements in a documented sequence. Every model call, retry and agent/tool invocation needs its **own attempt ID**. The existing prototype `runReservedBillableInference` is **not wired** to this journal yet, and adding a journal by itself does not close the settlement-crash atomicity window.

## Cloudflare Workers AI usage contract (documentation check, no paid call)

Cloudflare's current [AI run API documentation](https://developers.cloudflare.com/api/resources/ai/methods/run/)
lists optional `usage.prompt_tokens`, `usage.completion_tokens` and
`usage.total_tokens`. The Stage 3 strict meter accepts complete nonnegative
input/output counters; **when `total_tokens` is present, it now must equal
the safe integer sum of input plus output tokens**. An inconsistent or
non-integer total is `authoritative_usage_unverified`, preserving both
reservations until review. Missing optional `total_tokens` alone is allowed
if both other authoritative counters are complete and consistent.

Cloudflare [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
(updated 12 Nov 2026) publishes model token-equivalent rates but says
the underlying Workers AI accounting is in **neurons**, includes a
10,000-neuron/day free allocation and depends on the Workers plan;
the configured model [lists](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
$0.293/M input tokens and $2.253/M output tokens. Neither the synthetic
test tariff nor a calculated micro-USD event establishes actual invoice
cost, consumption of the shared free allocation, account-specific
eligibility or billable usage. Compare a separately operator-approved
bounded staging call with provider dashboard/invoice before finance signoff.

For the first live metering check, record the sandbox account's Workers plan
and same-day Workers AI neuron total before running a single non-streaming
request with fixed synthetic input and a 16-token output cap. Keep the UTC time,
model ID and returned input/output counters, and compare the recorded neuron
total after usage reporting catches up. Use the same UTC day for both readings.
The published Llama 3.3 rates are 26,668 neurons per million input tokens and
204,805 per million output tokens. Using the 24,000-token context as a
conservative input bound, a single probe with at most 16 output tokens has a
published-rate estimate of about 643.31 neurons, or $0.007069 before any free
allocation. If the aggregate has other traffic, it cannot attribute the entire
delta to the probe. A matched usage delta checks metering. Invoice
reconciliation still requires Cloudflare's billable usage for the billing period.

### Observed Workers Free sandbox metering

The [live metering run](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44105707860)
sent one request at `2026-11-17T14:40:53.803Z` and received 42 prompt tokens,
2 completion tokens, and 44 total tokens. A durable request claim prevented
replay. The workflow verified that the Worker route was disabled at the end.
The owner confirmed the sandbox was on Workers Free and reported the dashboard
value **Neurons used today: 1.53/10k** after the request. The published rates
yield **1.529666 neurons**, which rounds to the observed daily dashboard total.
The per-model chart showed no data for its selected range. This comparison
uses the daily total and has no numeric pre-run baseline.

The list-price estimate is **17 micro-USD** when rounded up per request.
The sandbox request was within the free allowance. An overage invoice and
paid-plan billing remain unverified.

### Live sandbox settlement

The [settlement proof](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44107564777)
ran one real Workers AI request through the journal, budget and wallet on a
separate sandbox D1. The provider reported 42 input and 2 output tokens. The
budget and test wallet each reserved 7,069 units in their respective ledgers
and settled 17 at the model's published tariff. The test wallet ended at 7,052
microcredits. D1 recorded one dispatch, one measured event and one reservation
per ledger. The repeated request was refused before invoking the provider again.
The workflow verified that Worker routing was disabled after the proof.

## Safety and privacy

- No migrations against production or the Stage 2 disposable remote test DB.
- No real payment, Workers AI, Tavily, Midtrans or external API calls.
- No prompt, output, auth token, email address, provider payload or customer identity stored. Identifiers must be server-issued random opaque references and are still subject to retention and access-control review.
- An "unknown" event cannot be claimed to cost zero; a later trusted measured event may resolve it without rewriting history.
- `approved:true` in a synthetic test fixture is **not** tariff approval for real customers. The source, price, metering and owner decisions must be independently verified and versioned.
- This report does **not** prove provider billing or invoice correctness and cannot authorize Stage 3 production.

## Remaining gates

| Gate for issue [#253](https://github.com/muhriskiawan23/ai-command-center/issues/253) | Evidence and remaining work |
| --- | --- |
| Provider metering | Workers Free Llama 3.3 usage matched the daily dashboard total. The paid invoice and other proposed models remain unverified. |
| Journal, provider budget and wallet | Remote sandbox verified synthetic application paths and one live Llama 3.3 settlement through the fixed staging probe. Billable application routes still need an authenticated integration with server-issued customer and request IDs, including retry identity and model caps. |
| Failure recovery | Sandbox verified replay rejection and unverified-usage holds. The read-only [hold triage](STAGE-3-HOLD-TRIAGE.md) flags stale dispatches by attempt. Operator reconciliation mutations, crash recovery and compensating adjustment policy remain open. |
| Tariff and release controls | Review model and tool rates, credit conversion, fees, margin, alerts, kill switch, rollback and phased rollout before enabling paid traffic. |
| Independent review | Complete security and privacy review, including [#156](https://github.com/muhriskiawan23/ai-command-center/issues/156), and finance review before founder release approval. |
| Payments | Midtrans [#246](https://github.com/muhriskiawan23/ai-command-center/pull/246) covers the design. Sandbox [#247](https://github.com/muhriskiawan23/ai-command-center/pull/247) has verified settlement and replay protection in tests. Live webhook replay and partial reversal, chargeback and spent-credit policies remain open in addition to merchant approval. |

Tracked in [Stage 3 issue #253](https://github.com/muhriskiawan23/ai-command-center/issues/253) and [Stage 2 PR #245](https://github.com/muhriskiawan23/ai-command-center/pull/245). Preserve production quota controls and keep URL Reader off.

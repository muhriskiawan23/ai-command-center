# BOR AI Stage 3 — provider statement arithmetic drill (inactive)

Status: **SYNTHETIC, READ ONLY, NOT A PROVIDER INVOICE VERIFICATION**.
This document and the companion source code are kept only in Draft PR #255.
No live Cloudflare AI call, D1 remote query, paid API, payment, refund,
pricing activation, merge or production migration is authorized.

## Why this check is necessary

Cloudflare Workers AI model token rates are reference estimates, not proof
of the billed amount on a real invoice. A model response may omit usage,
time out after provider dispatch, retry or be billed using a provider-specific
neuron or rounding convention. An internally balanced wallet and budget
do not prove that the upstream provider was billed the same amount.

The new inactive `src/stage3-provider-statement-review.js` provides:

- `inspectStage3InternalDailyCosts`: a **single read-only SQLite query**
  aggregating journaled model dispatches, measured attempts, unresolved
  attempts and integer micro-USD internal cost by UTC **dispatch day**,
  provider and model. It emits no account IDs, request IDs, attempt IDs,
  prompts, raw token usage or individual balances. The queried date range
  is capped at 31 days and output at 200 groups.
- `compareStage3ProviderStatement`: a pure in-memory arithmetic comparison
  of those groups against externally supplied integer micro-USD statement
  totals. Missing, extra, duplicate, unmeasured or mismatched entries are
  surfaced instead of silently treated as zero.
- Both functions always report `providerInvoiceVerified:false` and
  `operatorActionAuthorized:false`. Even an exact arithmetic match
  **does not authenticate** that any source statement genuinely came from
  Cloudflare or correctly represents a final invoice.

The UTC dispatch day is a grouping convention for the internal journal,
not necessarily the true provider billing day. A time boundary or delayed
response can require a documented allocation adjustment before external
reconciliation. Never alter append-only journal entries to force a match.

## Local proof

    node --test tests/stage3-provider-statement-review.test.js

This loads the same proposed, unapplied SQL migrations 0012, 0013 and 0014
into disposable in-memory SQLite and writes only fictional usage events.
Tests check two metered calls aggregated to 1,038 synthetic micro-USD,
an unmeasured provider attempt, matching and nonmatching user-supplied
statement totals, duplicates, fractional input rejection, invalid dates,
privacy minimization and read-only operation.

**No real provider statement is loaded, received or validated in this test.**
All example prices, quantities and amounts are synthetic fixtures.

## Required external verification gates

Before any real customer tariff or recovery operation is approved:

1. Establish a separately authorized and access-controlled method to
   retrieve authentic Cloudflare billing/neurons, charged model usage,
   invoice or account statement, with date, currency, billing basis,
   source account and immutable evidence reference.
2. Confirm which costs are token-equivalent and which are neuron-based,
   any free-tier offset, minimum rounding, credits and tax; reconcile
   **every** dispatch and provider retry with the corresponding billing
   period and real provider amount. A model-level daily aggregate alone
   may be insufficient for a specific customer's dispute.
3. Handle incomplete and delayed provider data explicitly: do not
   finalize disputed wallet holds or issue automatic refunds while
   authoritative costs are unknown. Capture the journal rate version
   and customer tariff separately from actual provider billed cost.
4. Obtain independent finance and security signoff of source provenance,
   account identity, pricing and access rights, and explicit founder
   approval of any production-facing recovery or billing changes.

The accounting rule remains **fail closed**. A passing local CI run is
not a paid invoice match, not a margin guarantee and not release approval.

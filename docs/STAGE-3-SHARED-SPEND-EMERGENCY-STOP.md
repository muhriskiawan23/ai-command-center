# Stage 3 — shared D1 provider emergency stop (DRAFT / UNAPPLIED)

**18 November 2026. NO-GO for paid release.** This design is staged in
Draft PR #264 and is **not** installed in the deployed BOR AI Worker.

## Objective

Prevent further **new** paid-provider budget reservations across separate
Workers or server instances when an authenticated operator disables spending.
A per-Worker environment variable alone is not a reliable, immediately
coordinated network-wide switch. A shared database state also makes the
disable decision enforceable at the atomic reservation boundary.

## D1 design

`migrations/0018_provider_emergency_stop_draft.sql` introduces one
`provider_runtime_controls` row named `paid_provider_dispatch`,
initially `enabled=0`. Its BEFORE INSERT trigger on
`provider_budget_reservations` rejects all new provider and
cross-provider reservations unless that row is exactly enabled. SQLite's
single-statement transaction rolls back earlier reservation-trigger updates
if this check fails. This applies to token AI **and** media reservations
that use the same provider-budget table.

The draft Stage 3 inference gate also verifies that D1 row on every
entitlement recheck: before reserving budget, after both financial holds,
after the append-only dispatch marker, before financial settlement, and
after settlement before output delivery. The synthetic staging Worker
checks the same row before issuing a paid idempotency claim. A missing
table/row, corrupt value, unavailable D1 binding or read error results in
denial of new paid access, not a permissive fallback.

The combined, ephemeral Miniflare smoke requires an *explicit synthetic*
SQL flip to ON and verifies that OFF rejects paid requests with no new
claims, journal writes or financial reservations. Reenabling ON permits a
previously refused request, and the normal idempotency protections prevent
duplicate charges. An isolated SQLite test checks the trigger itself,
direct inserts, OFF->ON->OFF transitions and settlement of existing holds
while paused. Other tests simulate the switch being toggled OFF while
the model/journal callbacks execute.

## Operational limitations — not a production kill switch yet

- **No operator API or mutation permission is implemented.** Synthetic
  SQL updates in tests are **not** approval to edit the real database.
  A real, logged and independently authenticated two-person operator
  workflow, deployment procedure and rollback still need review.
- The budget trigger provides atomic admission control for **new**
  reservations only. It cannot retroactively stop a provider call already
  executing or guarantee that an upstream vendor honors cancellation.
  An OFF toggle between the final DB read and an outbound call is a
  time-of-check/time-of-use window. Actual zero-new-spend guarantees need
  a reviewed dispatch boundary and provider-level shutdown proof.
- Wallet holds, immutable journal events and budget reservations already
  created **remain intact** after OFF. They must be reviewed against
  authoritative provider statements; neither auto-release nor auto-debit
  is permitted based only on a timeout or pause.
- The read-only row is checked each time, not cached, but a hosted,
  cross-instance consistency/concurrency proof is still required.
  Local SQLite/Miniflare passing is not remote Cloudflare D1 proof.
- Model/provider billable units, approved per-model tariffs, daily caps,
  Midtrans merchant status and independent security/privacy/finance approval
  are all separate blockers. No price or payment change follows from this
  staging proof.

**Safety:** URL Reader OFF; no API keys, production migrations, payments,
paid model calls, remote DB edits, merge or deployment performed.

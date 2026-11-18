# BOR AI Stage 3 — operator recovery runbook (DRAFT / NO AUTHORITY)

**Date:** 18 November 2026. **Status:** pre-launch, review-only.
No operator UI, mutating recovery endpoint, paid billing authorization, or
production release exists in this document. No real Midtrans/provider
identity, model invoice, account data or secrets are used in test fixtures.

## Default position

- Shared D1 paid-provider dispatch remains **OFF** by default; emergency
  OFF halts *new reservations*, not vendor calls already in flight.
- Never infer `actualCost=0` merely because a Worker died, a model timed
  out, the browser disconnected, or a provider returned an ambiguous error.
- Never retry the same billable customer request with a fresh attempt when
  an upstream result might have been charged. Preserve original IDs, both
  holds and journal records for independent reconciliation.
- The three inspection modules are **read-only** and do not give
  settlement, refund, chargeback, migration, or debit authority.

## Evidence collection: two reviewers, minimal disclosure

1. **Incident intake:** authorized operator identifies the case in a
   restricted internal system with authenticated user/request linkage.
   Keep identifiers and vendor invoice references in that restricted
   case record; never send them to public logs, status endpoints or
   model prompts.
2. **Freeze exposure if needed:** an independently authorized operator
   may propose suspending *new* spending through the reviewed D1
   emergency-control procedure. In this Draft there is **no** deployable
   operator API or approved production write workflow.
3. **Collect read-only evidence:** capture a consistent D1 snapshot of
   credit reservations, append-only ledger, provider/global daily budget,
   provider reservations, immutable dispatch/usage journal, and original
   plan/payment revocation state. Verify tenant ID, provider, model,
   tariff version and authenticated request identity. Do not copy raw
   customer prompts or media bytes.
4. **Confirm external source:** obtain a **provider-issued** authoritative
   receipt/usage record and billing line item for *each attempt*, including
   failed/time-out attempts. A locally measured token count or synthetic
   cost estimate is not proof of invoice settlement.
5. **Independent review:** reviewer A proposes a classification with
   supporting hashes/counts. Reviewer B independently verifies record
   provenance, totals, time windows, provider identity, tariff and
   whether another attempt was already charged. No sole reviewer can
   authorize a money-moving action.
6. **Manual disposition only after approval:** maintain a separately
   approved, auditable finance procedure for any future compensation.
   It must be idempotent and preserve immutable records; do not directly
   edit balances or delete reservations. If provider evidence is absent,
   keep the case in `escalate` and holds unresolved.
7. **Post-action proof:** re-run the three read-only inspections, compare
   provider daily/global budgets and original/updated wallet ledger,
   verify no duplicate debit/refund, and record who approved and executed.
   No automatic appeal or refund of uncertain attempts is implied.

## Read-only classification examples

| Interruption | Required interpretation |
| --- | --- |
| Budget reserved, wallet missing | Stale orphan: inspect budget trigger, preserve hold, no AI replay |
| Both reservations before dispatch | Possible non-dispatch: verify no provider call before any release proposal |
| Dispatch persisted, no outcome | Unknown provider cost: hold for authoritative invoice |
| Provider timeout + unknown event | Same as unknown: timeout does not prove free service |
| Measured usage, both reservations pending | Candidate only: compare actual provider bill and tariff |
| Provider settled, wallet pending | Candidate wallet review; no automatic finalization |
| Wallet settled before provider | Escalate unsafe financial ordering |
| Emergency OFF | New reservations denied; existing holds and immutable history remain |

## Verified scope and open release gates

The regression suite `tests/stage3-crash-recovery-matrix.test.js`
tests six persisted partial-state snapshots **without closing the DB**.
`tests/stage3-disk-restart-recovery.test.js` additionally uses a
temporary physical SQLite database, closes its connection, reopens that
same file and checks orphan reservations, dispatch/timeout evidence,
provider-settled-but-wallet-held cases, emergency OFF persistence, replay
rejection, and corrupt/missing journal fail-closed behavior.
A separate opt-in-free CI proof,
`tests/billing/stage3-workerd-restart-smoke.mjs`, uses the previously
locked Miniflare/workerd dependencies with a temporary persistence root,
fictional Basic payment records and no outbound network access. It
**disposes the local workerd instance and creates a new instance twice**,
reusing the same local persisted D1 state. Its assertions cover a fake
provider's unverified usage, surviving credit and provider holds, request
idempotency after restart, and a shared D1 emergency OFF state surviving a
second restart. Only a successful *exact-head* CI run can count as evidence
that the workerd restart proof passed.

These are local disk/workerd runtime-recreation tests, **not remote
Cloudflare D1, a forced live Worker crash, cross-region consistency
proof, provider invoice comparison, or an approved operator write**.
Additional hosted validation, recovery-service design and independent
security/finance review are required before BOR AI can charge customers.

**No network/provider calls, payments, production D1 operations, merge
or deployment are authorized by this document.**

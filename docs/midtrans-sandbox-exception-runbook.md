# Midtrans Sandbox payment exceptions

Use this runbook with `bor-ai-midtrans-sandbox` and the Midtrans Sandbox dashboard. It describes current behavior and the proposed operator decisions for cases that need review.

| Case | Current Sandbox behavior | Operator action |
| --- | --- | --- |
| Confirmed full refund with sufficient balance | The D1 trigger reverses the original grant once and sets the order to `refunded`. | Verify one grant and one matching reversal. |
| Partial refund | Records a review event without debiting credits. | Record the provider-confirmed cumulative amount. Keep the case in review until an approved credit adjustment rule exists. |
| Chargeback or partial chargeback | Records a review event. An earlier recorded chargeback blocks automatic refund reversal. | Compare the latest provider status with the ledger. Escalate the dispute and any credit adjustment together. |
| Full refund without bank confirmation | Records a review event without debiting credits. | Recheck the provider refund details when confirmation is available. Check whether a later notification completed the reversal. |
| Full refund with insufficient credit balance | Records `review_required` on the reversal without debiting credits. | Record the current balance and original grant. Escalate any adjustment or write-off for an owner decision. |
| Expired or cancelled unpaid order | Payment verification does not authorize a credit grant. | Confirm the terminal status at Midtrans and verify that no grant exists. If the customer still wants to pay, start a new checkout. |

A review event is historical evidence. If it coexists with a reversal marked `reversed`, verify the ledger before deciding whether any dispute still needs attention. A provider status that disagrees with the ledger requires investigation. Preserve the original grant and any existing reversal throughout review.

## Read-only D1 verification

Bind the order ID or replace `ORDER_ID` in the D1 Console.

```sql
SELECT p.order_id, p.state, r.outcome,
       (SELECT group_concat(v.provider_status, ', ')
          FROM sandbox_payment_reversal_reviews v
         WHERE v.order_id = p.order_id) AS review_events,
       (SELECT COUNT(*) FROM credit_ledger l
         WHERE l.reference_id = p.order_id AND l.reason = 'payment_grant') AS grants,
       (SELECT COUNT(*) FROM credit_ledger l
         WHERE l.reference_id = p.order_id AND l.reason = 'payment_reversal') AS reversals,
       (SELECT COALESCE(SUM(l.delta_microcredits), 0) FROM credit_ledger l
         WHERE l.reference_id = p.order_id
           AND l.reason IN ('payment_grant', 'payment_reversal')) AS net_microcredits
FROM payment_orders p
LEFT JOIN sandbox_payment_reversals r ON r.order_id = p.order_id
WHERE p.environment = 'sandbox' AND p.order_id = 'ORDER_ID';
```

Record the provider outcome and the query result together. For a full refund completed automatically, expect `refunded`, outcome `reversed`, one grant, one reversal, and net zero. For an unpaid expired or cancelled order, expect zero grants and reversals. Keep partial-refund credits, chargeback recovery, and already-spent credit adjustments subject to explicit policy before enabling paid production access.


### Bounded streaming body handling (18 November 2026)
The isolated sandbox Worker now places a 10-second deadline and request-abort
handling around every streamed notification, operator reconciliation JSON, and
Snap checkout response JSON. Both streamed and advertised body sizes are
bounded to 16 KiB and malformed UTF-8 fails closed. A stalled/disconnected
notification cannot advance fulfillment or call the trusted Midtrans Status API.
The new local tests simulate an aborted partial webhook, oversized streamed
and declared bodies, and invalid UTF-8 without touching Midtrans or D1.

These checks do **not** authorize merchant activation, production integration,
or retry/release of funds after an unknown Midtrans provider response. Continue
using signed webhook plus independently verified Status API, exact order/amount
and merchant match, operator review for disputed payments, and the separate
merchant approval process before a commercial launch.


### Independent Midtrans Status API deadline (18 November 2026)
The sandbox-only `readVerifiedSandboxStatus` adapter now has its own bounded
8-second maximum deadline spanning both HTTP response headers and fully
consumed JSON body, rather than relying solely on a caller's fetch timeout.
A stalled chunked body or fetch that ignores the supplied AbortSignal cannot
keep a payment verification waiting indefinitely. Already-aborted lookups
never initiate a network request. An interrupted or expired verification
fails closed: no independent paid proof is returned and no credit can be
granted by this adapter. Local regression fixtures simulate stalled headers,
stalled response body, cancellation and invalid timeout configuration.
The existing 32 KiB streaming response cap and signed-webhook + independent
Status API checks remain intact. No remote payment was initiated.

### Status API stream cleanup on deadline (18 November 2026)
The independent 8-second status deadline now actively aborts the network
operation **and** cancels the current streamed JSON reader. Cancellation is
not awaited, since a broken transport can return an unresolved cancellation
promise. An oversized Content-Length is also rejected immediately without
waiting for stream cancellation. Synthetic regression tests cover a provider
that stalls after partial JSON, a provider with a never-resolving cancel
promise, and an oversized response with the same failure mode.
No timeout or interrupted response authorizes a payment grant. This does
not replace Midtrans production activation, merchant review or invoice
verification.


### Independent IDR confirmation before credit (18 November 2026)
The isolated sandbox webhook path, like authenticated operator
reconciliation, now requires the independent Midtrans Status API to return
an **explicit** `currency: "IDR"` matching the IDR order. A valid signed
webhook and matching numeric amount alone cannot fill a missing or
ambiguous currency claim from the authoritative status response.
Missing, null, or foreign currency causes a fail-closed status error
with no D1 order transition, ledger grant or account credit.
An optional currency field omitted from the *signed notification* can
still be accepted when its independent Status API response explicitly
confirms IDR; the trusted status result remains the source of truth.
Local synthetic SQLite tests cover missing currency, USD/null and the
positive signed-webhook case. This is not real Midtrans invoice evidence.


### New dispute after a completed refund (18 November 2026)
Even when a verified **full refund** has already reversed the original credit
grant and set the order to `refunded`, a *subsequent independently verified*
`chargeback`, `partial_chargeback`, or `partial_refund` is not an ordinary
refund replay. The Sandbox webhook records a privacy-minimal, idempotent
`sandbox_payment_reversal_reviews` marker and returns `review_required`.
It does **not** debit the customer twice, re-grant credit, overwrite the
already-reconciled refund, or silently classify the dispute as `unchanged`.
The provider transaction ID, merchant, currency and original amount must
still match, and the Status API must confirm a reversal status before the
marker is created. Identical later events do not duplicate the marker.
Investigate the new provider dispute and reconcile it against the historical
grant/reversal before any production policy is enabled.


### Tamper-resistant sandbox refund/dispute labels (18 November 2026)
The **review-only** `payment-reversals-review.sql` now adds
`sandbox_reversal_state_guard` to reject any new sandbox
`refunded`/`disputed` order-state transition without the matching
same-order, same-transaction, same-amount, correct-kind reversal record in
`sandbox_payment_reversals` with outcome `reversed` or
`review_required`. It also refuses a direct terminal refund/dispute
transition from `paid_unfulfilled`. The only intended successful path is
the existing atomic reversal INSERT trigger: record the decision, debit
the credit wallet if sufficient, append the ledger event, then update
the order. If credits have already been spent, retain `review_required`
and never make the wallet negative. Direct manual SQL status edits are
**not** provider confirmation and must not create a false financial outcome.
Dedicated SQLite and real local D1 smoke regressions check the new guard.
These review-only SQL files are not production migrations and are not
authorized to run against remote D1 without staging review.


### Append-only reversal and dispute evidence (18 November 2026)
The reviewed sandbox SQL now forbids deleting `sandbox_payment_reversals`
records and prevents updating their final outcomes or original financial
identity. The only legitimate internal update is the atomic reversal
INSERT trigger moving `pending` to `reversed` or `review_required`.
`sandbox_payment_reversal_reviews` markers are likewise immutable and
cannot be deleted using ad hoc SQL. Repeated dispute notifications remain
idempotent through their composite primary key and `ON CONFLICT DO NOTHING`.
These integrity constraints are tested with SQLite and real local Cloudflare
D1, including failed UPDATE/DELETE attempts without changing credit balances.
This is a **sandbox-only review schema**, not an approved retention/deletion
policy or a production migration. A legal erasure/retention process needs a
separately reviewed approach that preserves required financial auditability.

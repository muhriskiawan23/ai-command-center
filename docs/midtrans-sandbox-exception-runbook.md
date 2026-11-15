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

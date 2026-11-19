# BOR AI — Manual Basic/Pro monthly lifecycle (offline staging proof)

**NO LIVE PAYMENTS; NO CUSTOMER ENTITLEMENTS; NOT DEPLOYED.**
This is a standalone, staging-only prototype for P0 issue #319.
`src/billing-manual-subscriptions-offline.js` is not imported by production
or the staging HTTP Worker, and it never calls Duitku or a model provider.

## Explicit product contract

- Basic **$1.99/month**, Pro **$6.99/month** remain provisional, not approved
  for commercial sale. Proposed synthetic credits: **3,000/15,000**.
- A Duitku VA sandbox invoice is a **one-time payment**, not an automatic
  monthly subscription debit. This implementation is **manual_only** and
  cannot automatically debit or create invoices.
- Each period belongs to an authenticated synthetic user and a **distinct**
  already-`paid` Basic or Pro order with an immutable matching quote,
  provider-verified payment-event record, and **exactly one** staging
  credit-grant ledger row. Pending, unpaid, refunded, chargeback, top-up
  and wrong-owner orders cannot issue a monthly term.
- A newly paid order for the same user starts its term at the later of the
  current time or the end of the last unrevoked term. This avoids
  overlapping paid terms and makes prepayment a queued next period.
- Each period lasts **one UTC calendar month**, with end-of-month clamping
  (Jan 31 → Feb 28/29). The expiration boundary is exclusive.
- The user may request `cancel_at_period_end`: access remains valid
  until the end of the paid period, but **no automatic renewal is created**.
  Cancellation does not imply cash refund or immediate credit reversal.
- A refund/chargeback **immediately disables access on the read side**
  because the linked order is no longer paid, even if the separate
  entitlement-term revocation record has not yet been updated.
- `revokeManualSyntheticTerm` requires a matching **already-recorded**
  refund/chargeback event and one matching ledger clawback; a caller's
  claimed reason or HTTP return URL cannot revoke or refund anything.
  Historical rows cannot be deleted or repriced.

## Excluded pending business decisions

- Not the Duitku Subscription API. Auto-renewal requires separate
  customer consent, merchant/channel approval, and certified webhook
  semantics; no generic VA auto-debit is assumed.
- No recurring scheduling, card storage, dunning/grace periods, proration,
  monthly unused-credit rollover, VAT/tax receipt, commercial cancellation
  terms or automated money refund.
- Monthly credit reset/rollover liability and top-up expiry must be
  defined and tested separately before live activation.
- Not production authentication or a customer-facing billing portal;
  only in-memory tests and an isolated staging D1 schema.

## Technical gates

D1 migration `0008_manual_subscription_terms.sql` adds a new
`billing_subscription_terms` table in the **independent staging D1 only**.
Triggers enforce paid provider proof and exactly-once grant, non-overlap,
immutable snapshot, manual-only renewal and evidence-backed refund/chargeback
revocation. It does not change existing billing orders or the credit wallet.

Run `node --test tests/billing-manual-subscriptions-offline.test.js`
for first payment and renewal, cancellation, paid-order replay, UTC
month boundaries including leap years, tenant isolation, fake refund
claims, true synthetic reversals, debt freeze and immutable records.

**Migration 0008 is NOT automatically deployed to remote Cloudflare**.
Review and obtain operator authorization before applying any additional
staging migration. No production deploy or production D1 change is required.

Reference: [Duitku's separate recurring subscription product]
(https://docs.duitku.com/subscription/id/).

**Billing production remains NO-GO** pending merchant approval,
real credit/metering integration, live refund/dispute proof and review
of consumer terms and operational readiness.

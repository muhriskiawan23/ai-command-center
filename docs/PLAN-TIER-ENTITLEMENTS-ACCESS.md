# BOR AI — Free, Basic & Pro server-side access contract

Status: **DRAFT / INACTIVE** in Draft PR #264 stacked on Stage 3 Draft
PR #255. This is not a production payment launch, subscription grant or
remote D1 migration. The feature flag `PLAN_ENTITLEMENTS_ENABLED` must
remain **off** in production until the complete launch review.

## Access is a hierarchy, not a client-side switch

| Chosen active mode | Free capabilities | Basic paid capabilities | Pro paid capabilities |
| --- | --- | --- | --- |
| **Free** | Yes | No | No |
| **Basic** | Yes | Yes | No |
| **Pro** | Yes | Yes | Yes |

- Free retains **existing** chat, specialist agents and multi-agent quota
  features. Do not silently remove existing Free functionality.
- A verified Basic subscriber can select **Free or Basic**, never Pro.
- A verified Pro subscriber can select **Free, Basic or Pro**, including
  switching back and forth before the paid period ends. When a Pro customer
  selects Basic, they have **Basic feature access**, not a second Basic
  subscription, additional Basic credits or a second wallet.
- Selecting Free does **not** cancel or refund an existing subscription.
  Cancelling, downgrading, refunding and chargeback are **billing lifecycle
  events**, distinct from switching the currently used app mode.
- Free visitors/guest users have no paid access. Sign-in with a valid
  server-side session is required to select a paid mode; a browser-supplied
  account ID or `plan=pro` query parameter is never trusted.

## First-pass capability mapping

- **Free**: `chat`, `specialist_agents`, `multi_agent`,
  `signed_in_history` (Google-account sign-in required).
- **Basic** (inherits Free): `basic_paid_credits`, `credit_topups`.
- **Pro** (inherits Free+Basic): `pro_credit_capacity`,
  `pro_rollover_eligibility` (eligibility alone; rollover is **not**
  enabled unless pricing/margin and credit-lot mechanics are approved).

The Basic $1.99 and Pro $6.99 list prices do **not** prove profitability,
credit counts, rate/latency guarantees, priority queuing, unlimited calls,
or premium models. Higher Pro capacity and any rollover remain subject to
verified provider costs and credit allocation. Free daily quota limits
remain separate from future paid-credit accounting.

## Server trust boundary

1. `verified_plan_payments` (proposed migration 0016) is a **future
   internal eligibility proof table** that only an audited backend payment
   reconciliation service may write. It must validate signed Midtrans
   notifications, independent Midtrans Status API, merchant identity,
   expected order/user/plan, exact USD/IDR checkout snapshot, confirmed
   amount/currency, fraud, duplicate notifications, reversals/refunds and
   chargebacks. No such real service or grant is connected by this PR.
2. `plan_entitlements` has **one paid tier per user**, at most one unique
   provider order, and a bounded active paid period. The runtime joins
   payment proof to the **same account and tier** and requires status
   `verified_paid`, `active` and a not-expired period.
3. `plan_selections` stores the user's preferred app mode separately.
   A single conditional SQL INSERT/UPDATE permits switching upward only
   while the joined paid entitlement is still valid. The server rechecks
   entitlement on **every protected paid feature request**; it does not
   rely on a cached browser plan, a signed token claim or the dropdown.
4. `GET /api/plan` reports only safe current mode, available tiers and
   capability labels; `POST /api/plan/select` accepts **only** `tier`
   after validating the authenticated session and same-origin request.
   Neither route creates a payment, grants credits, activates checkout,
   performs model inference or modifies the payment ledger.
5. An inactive staging inference prototype optionally calls
   `authorizePlanFeature` **before provider budget reservation or AI
   dispatch** when the stage's plan gate is enabled. A server-approved
   Basic tariff requires `basic_paid_credits`; a server-approved Pro
   tariff requires `pro_credit_capacity`. The prototype remains
   synthetic and **must not** be promoted to production as a paid
   inference implementation without an unconditional reviewed guard,
   credit-grant/usage enforcement, refund safety and launch approval.

## Revocation and failure behavior

- No verified paid order, no entitlement, expired window, future period,
  pending, past-due, cancelled, refunded, charged back or revoked proof:
  **effective Free**. A previously stored Basic/Pro selection cannot
  override it. Re-upgrade requires a newly valid paid entitlement.
- Missing D1 binding/schema, malformed active paid proof or inconsistent
  data: **fail closed**, 503. Do not infer a verified entitlement from
  missing tables, message text, browser redirect or client metadata.
- A mismatch between the payment's user/tier and requested account cannot
  grant access. Direct payments and credits are **not** written by a
  user-facing mode selector.
- Plan results and responses are `Cache-Control: no-store`; server
  request-scoped checks must still protect all future paid entrypoints
  including public API, Telegram, tool calls and agent retries.
- Billing source state changes (refund, chargeback) must **revoke proof
  immediately** and reconcile active in-flight requests. That integration
  is not present. Actual payment confirmations and renewal credit grants
  must be exactly-once and reconciled against the immutable ledger.
- Temporary entitlement and account-select records may cascade on account
  deletion; any legally necessary retained invoices must have their own
  minimized, independently reviewed retention architecture.

## Automated local-only evidence

`node --test tests/plan-entitlements.test.js` uses the real Worker,
actual proposed D1 migrations and fictional payment records to exercise
Free/Basic/Pro inheritance, Pro-to-Basic-to-Free mode switches, denied
upgrades, account separation, invalid input, CSRF, refund/chargeback,
expiry, missing schema and denial **before** synthetic paid provider dispatch.

No actual subscription, invoice, premium inference or customer billing
is authorized by these tests. Maintain an independent reviewer signoff
and explicit founder approval before applying migration 0016 or
`PLAN_ENTITLEMENTS_ENABLED=true` in any environment beyond a newly
authorized isolated disposable stage.

## Next paid release acceptance gates

- Midtrans merchant activation + live permitted contract and fee schedule.
- Verified payment source implementation and reconciliation with order,
  payment event, subscription, renewals and all refund/chargeback states.
- Versioned approved quotas, token metering, margins and credit grant/lot
  rules for each plan; prevent double credits across a plan switch.
- Positive and negative end-to-end tests on an expressly approved isolated
  D1 and payment sandbox; audit per route and real source evidence.
- Finance, security/privacy and founder's explicit go/no-go. **NO MERGE,
  DEPLOY, PRODUCTION MIGRATION OR LIVE BILLING FROM THIS PR.**

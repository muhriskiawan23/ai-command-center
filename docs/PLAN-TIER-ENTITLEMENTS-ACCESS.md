# BOR AI — subscription entitlements, automatically inherited
Status: **Draft PR #264 stacked on Draft PR #255; inactive; no production deployment.**

## No manual mode selection
The **account's verified active subscription** is its fixed visible status.
Free is Free, Basic is Basic, and Pro is Pro. There is no Free/Basic/Pro
mode dropdown, no `/api/plan/select` update endpoint, and no `plan_selections`
database. The currently subscribed tier automatically includes every
lower tier's features, under the purchased plan's terms.

| Actual subscription | Free feature set | Basic features | Pro features |
| --- | --- | --- | --- |
| Free | Yes | No | No |
| Basic | Yes | Yes | No |
| Pro | Yes | Yes | Yes |

Changing subscription is a **payment and lifecycle operation**, not a UI
switch. Do not grant two parallel Basic and Pro credit allocations to Pro
subscribers; the **single Pro allocation** covers all usage, subject to
metered feature-specific limits. No unlimited use is promised.

## Source of truth
Future reviewed payment adapter alone may create `verified_plan_payments`
and `plan_entitlements`. That adapter does **not exist** in this draft.
It must independently authenticate the Midtrans notification + Status API,
match the server-side order, account, paid amount, currency, locked checkout
exchange rate, transaction settlement, merchant identity and time; process
duplicates, reversals, chargebacks and renewal ordering exactly once.

`src/plan-entitlements.js` joins those two independent tables to determine
the actual tier on every request: only an active, current, matching,
verified-paid subscription may unlock Basic/Pro. Missing table, malformed
proof, mismatch, expiry, future period or revoked source fail closed.
Guest users and unactivated paid billing remain Free.

`GET /api/plan` shows current plan and eligible capabilities without
customer data leakage. The former `POST /api/plan/select` always returns
404 and cannot mutate subscription or credits. Chat and public API reject
client-supplied `tier`, `plan`, `paidTier` and `credits` overrides.
The inactive Stage 3 paid inference prototype invokes plan authorization
**before** reserving provider cost, then requires independently functioning
wallet/provider budget/usage metering. Neither a plan entitlement nor a
front-end status badge issues spendable credits by itself.

## Proposed distinctions, NOT yet implemented customer entitlements
- **Free**: existing text chat, specialist agents and multi-agent under
  existing Free daily unit limits. These already exist and must not be
  falsely described as Pro exclusives.
- **Basic**: proposed image question-answering, image generation, wallpaper
  creation, photo editing/effects, basic paid credits, optional top-ups.
- **Pro**: all Basic + Free, plus proposed video frame analysis, richer video
  analysis/summaries, high-detail artwork, multi-reference image edits and
  greater approved credit capacity. No unlimited use.
- Image/video unit costs, real available models, copyright/privacy,
  MIME validation, limits, storage expiry, moderation, image quotas and
  customer margin still require independent approval. Neither the feature
  labels nor subscription UI activate any model call.

## Verification and rollout
Automated tests use fictional payment proof rows in disposable SQLite.
The browser E2E confirms Pro **always displays Pro**, Basic always Basic,
Free stays Free, with no selectable downgrade and immediate revocation on
a simulated refund. All protected future image/video operations must call
the same plan gate and apply the **actual** per-feature credit budget.

**NO-GO**: do not merge/deploy, migrate production or enable either payment
or multimodal generation until Midtrans commercial approval, a real
signature-and-Status-API-verified payment pipeline, measured paid provider
invoices, credit grants and limits, opt-in staging evaluation, independent
finance/security/privacy review are complete. The owner has authorized continuing
implementation and bug fixes; this does not replace the missing technical
and provider evidence required for commercial release.

The UI rechecks the package at server-reported expiry, within 60 seconds while
visible, and when the tab resumes. A stale badge never authorizes a request.
The linked `/paket.html` comparison page exists and labels unreleased media
features as planned; it offers no tier selector or checkout.


### Stage 3 mid-flight revocation and default-deny gates — 18 November 2026
The inactive journaled AI-spend prototype now **defaults to refusing any
billable operation** when `PLAN_ENTITLEMENTS_ENABLED` is not exactly
`true`, before reserving provider budget or customer credits. Its only
alternative is a separate, explicit `STAGE3_SYNTHETIC_ONLY=true` switch
used by isolated mock providers/disposable D1 tests; the production Wrangler
configuration does not set it, and an environment with a real `AI` binding
cannot use this proof-only bypass. It is not a production deployment flag
or permission to charge users.

When verified plans are enabled, the prototype checks the server-verified
Basic/Pro entitlement before reservation **and again before settlement and
after both financial settlements**. A refund, revocation, plan-gate disable
or database uncertainty mid-flight prevents the paid model output from
being returned. After model dispatch, provider cost may have accrued: the
prototype **holds** unsettled reservations for independent operator
reconciliation rather than incorrectly claiming zero provider cost.
If revocation occurs while settlement commits, the committed entries are
not automatically reversed; the result remains private and needs review.
This behavior is covered by synthetic tests for refund during provider
dispatch, refund during wallet settlement, removal of the plan flag and
missing plan-gate default denial. Live provider usage and invoice checks,
a real subscription merchant, and independent financial/security review
are still required before paid production activation.


### Independent paid-inference emergency stop
For the future plan-verified Stage 3 orchestration, **both**
`PLAN_ENTITLEMENTS_ENABLED=true` and `PAID_INFERENCE_ENABLED=true`
must be present before reserving a real provider budget or customer
credits. A paid subscription is not itself permission to call a billable
model. If the paid-inference switch changes or becomes unavailable after
dispatch, output is withheld and uncertain costs are held for operator
review; no automatic zero-cost refund is inferred. Synthetic tests use a
separate, never-production `STAGE3_SYNTHETIC_ONLY=true` marker.
The production Wrangler configuration must keep paid inference disabled
until provider usage and invoices, spend caps, independent reviews and
founder GO approval are complete. This is a per-request server-side
configuration gate, **not** yet a remotely controlled global emergency
kill switch with atomic cross-Worker propagation, which remains a
deployment/operational launch requirement.

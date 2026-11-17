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
finance/security/privacy review and founder approval are complete.- Verified Basic automatically has Basic status and inherits all Free features; it cannot use Pro-only features.
- Verified Pro automatically has Pro status and inherits all Basic and Free features. No downgrade-mode selector is exposed or accepted by the API.
- A plan change is a separately authorized billing lifecycle event, not a chat/UI setting. Cancellation, refunds, chargebacks and expiry change the server-verified entitlement, not a local mode.
- A Free guest or account without valid payment proof cannot self-promote through browser input, account IDs or query parameters.

3. There is **no** `plan_selections` table. The active tier is derived only from a current, verified server-side subscription. A Pro subscriber is always Pro while that entitlement remains valid.
4. `GET /api/plan` reports the current verified tier and inherited feature labels. `POST /api/plan/select` is intentionally removed (404). Neither route grants credit, accepts client tier changes or performs inference.


# BOR AI — Google-session-bound, read-only billing account shadow

**Scope:** production auth integration design/proof; actual customer billing,
payment, credits and subscription entitlements all OFF. This patch changes
source code only and is NOT a production deployment. The new route is
**404 by default** because no feature flag, secret, or separate D1 binding
has been configured in `wrangler.jsonc`.

## Source-of-truth discovered in BOR AI

- The real BOR AI Worker `src/index.js` already verifies Google ID tokens
  before saving users; it stores Google `sub` as `users.id` in
  the **production chat D1** `bor-ai-chat`.
- `getSession(request, env)` reads the HTTP-only auth cookie, SHA-256
  token hash, live `sessions` row, and its `users.id`. That existing
  server function — **not** an email, client-provided username or billing
  userId — is the only supported authenticated identity source.
- The Duitku billing Sandbox instead has operator-created synthetic
  `STAGE-...` users in a separate D1 `bor-ai-billing-staging`.
  Do not merge them or promote test credits to live customer credits.

## What this code implements

- An OFF-by-default `GET /api/billing/account` route in the real
  Worker, wired to the existing verified Google session `getSession`.
  It never accepts a client user ID, request body, model, credits,
  money amounts or login email as an account selector.
- An independent secret HMAC-SHA256 of
  `bor-ai-billing-shadow-subject-v1|<trusted_google_sub>` to locate
  a pseudonymous account record. The shadow secret must be separate from
  login, Google OAuth, and Duitku secrets. It must never be exposed
  in the client bundle, logs, GitHub, docs, or HTTP responses.
- Requires a separate `BILLING_SHADOW_DB` D1 binding and attestation
  row `bor-billing-shadow-readonly/bor-ai-billing-shadow/v1`;
  mismatched `env.DB` binding, the existing production chat D1, the
  sandbox D1, missing table or failing attestation returns **503**.
- On success returns only an informational `accountStatus`:
  `not_enrolled`, `under_review`, or `blocked`; explicitly returns
  `billingReady:false`, `credits:null`,
  `productionCheckoutEnabled:false`,
  `realCreditsGranted:false`,
  `realSubscriptionEnabled:false`.
  It cannot show a paid plan or issue any real credit.
- No writes, payment callbacks, checkout URLs, provider calls, or
  automatic subscriptions. Cross-site fetches and querystrings are
  rejected; all responses use `Cache-Control: private, no-store`.

The schema at `staging/billing-shadow/0001_readonly_schema.sql` is
a **design fixture for a DIFFERENT possible future D1**
`bor-ai-billing-shadow`, not a migration for the existing
`bor-ai-chat` or `bor-ai-billing-staging`. It contains a sentinel
and non-monetary shadow status table keyed by the HMAC digest.
It is **not installed remotely**, and no service is configured to
write those rows.

## Why this is safe, but not yet commercial billing

This read-only identity bridge is a narrow prerequisite. It is not
`BILLING_DB`, not an entitlement engine and not a billable wallet.
The real provider/model/feature cost system, actual refund/cash
reconciliation, contractual merchant pricing, per-user credit
reservation, top-up/rollover liabilities and revenue/tax policy are
still P0 blockers (#317, #318 and #319). An operator must create
a separately reviewed production billing D1 and develop a fully
authenticated **write** path after approval; otherwise no real
user credit should ever be granted.

**Do not set `BOR_BILLING_SHADOW_ENABLED=true` or create
`BILLING_SHADOW_DB` based only on this PR.** A separate release
security review of actual D1 allocation, secret rotation, login cookie
scope, auth and rate limits must precede any controlled rollout.

## Tests

`node --test tests/billing-account-shadow.test.js` tests default
404, expired/untrusted sessions, wrong owner, query/POST/cross-site
denials, wrong D1/secret binding, mismatched sentinel, HMAC
determinism and separation, no PII leakage, noncommercial shadow
lookup by account, and confirms the production Wrangler file has
**no shadow binding or enabling flag**.

Deploy nothing from this PR. The existing live BOR AI chat continues
using its current user accounts and daily usage policy unchanged.

# BOR AI — Offline three-database billing identity isolation proof

This is a **non-production integration regression** for the Google-authenticated, read-only shadow account route. It does not create D1 databases, write to Cloudflare, call Google, issue payments, or grant credits.

## Run

```bash
node --test tests/billing-shadow-three-db-isolation.test.js
```

The test uses temporary on-disk SQLite files, all closed and deleted after execution:

| Fixture | Represents | Allowed role |
| --- | --- | --- |
| chat.sqlite | `bor-ai-chat` | Auth/session source, not billing storage |
| stage.sqlite | `bor-ai-billing-staging` | Synthetic-only test credits, never real customer credit |
| shadow.sqlite | Future `bor-ai-billing-shadow` | Isolated pseudonymous account statuses |

The test applies the actual shadow schema to **only** the third database, creates fixture records for the first two, and exercises the real `handleBillingShadowAccountRequest` function with a mocked server-verified session. It checks account A versus account B (including forged browser identity headers), protected status and no balance exposure, 404 when feature disabled, 401 without a session, and 503 when the shadow DB binding is pointed to chat/staging or is the same binding as chat. It verifies all fixture records, table definitions and database attachments are unchanged after the reads.

## Boundaries of this proof

- This is a Node/SQLite integration test, **not proof** of a live Google login, Cloudflare D1 binding, edge origin configuration, cookie scope, browser traffic, actual provider callback or live ledger correctness.
- The session function is injected and mocked. Existing production `getSession` behavior is covered by its own auth tests; do not mistake this for a real OIDC session integration test.
- The shadow schema is an undeployed fixture. No separate shadow D1 has been provisioned and the feature remains **OFF by default** in `wrangler.jsonc`.
- No commercial entitlements, paid subscription, live model usage credits or customer invoice are enabled.

## Promotion gates (manual review required)

Before any controlled deployment, review Google authentication/session expiration, cookie scope, origin/CORS policies, Cloudflare D1 account and binding identity, least-privilege access, HMAC pepper lifecycle/rotation, per-user rate limiting, production observability without identifiers, and rollback. Actual checkout/credits require **separate** authorization and complete verified metering, refunds/chargebacks and merchant readiness. Never reuse `bor-ai-billing-staging` data for real users.

# BOR AI — Verified-session Worker route offline regression

## Purpose

This follows the merged isolated shadow identity bridge (#329 and #330) and the three-DB offline persistence test (#331). The added test calls the **real `src/index.js` Worker `fetch` entrypoint**, not the standalone shadow handler, with the actual server-side `getSession` function. The production `getSession` function validates hashed cookie sessions by joining `sessions` and `users` with an expiry check; the test uses the real migration SQL for those tables.

## Offline fixture

`node --test tests/billing-shadow-worker-real-session-offline.test.js` creates and later removes three local on-disk SQLite databases:

- `chat.sqlite`: uses `migrations/0001_auth_and_chat.sql`, two simulated Google subject IDs, valid and expired hashed session cookies.
- `stage.sqlite`: synthetic, unused staging wallet with a fixed test-credit count.
- `shadow.sqlite`: applies **only** `staging/billing-shadow/0001_readonly_schema.sql`; a separate secret derives one account's noncommercial `under_review` status.

The test checks real Worker routing, valid session A versus B, spoofed identity headers, missing/invalid/expired cookies, cross-origin request rejection, querystring rejection, disabled-by-default flag, same-binding denial, no customer balance or identity disclosure, and SELECT-only operations on auth/shadow bindings. It also verifies local staging credit never changes.

## Important limitations

This test is **not** a live Google OIDC flow, Cloudflare D1 provisioning, payment test or live deployment. It exercises a real Worker route and real SQL using offline D1 adapters; it does not prove actual Cloudflare cookie/domain behavior, rate limiting, HMAC key rotation or external authentication. A protected rollout would require a separately reviewed shadow-only D1, secret policy, traffic monitoring, backout, and explicit operator opt-in. **Do not enable** `BOR_BILLING_SHADOW_ENABLED` or customer billing on the strength of this test alone.

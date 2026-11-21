# BOR AI Image-only D1 schema proof (local, non-deploying)

Run `node scripts/image-migration-offline-proof.mjs` or `node --test tests/image-migration-offline-proof.test.js`.

This builds a **fresh in-memory SQLite database**, applies base migrations `0001–0011`, then **only**:
1. `0012_image_jobs.sql`
2. `0016_image_chat_history.sql`

It checks the image wallet, jobs, credit-ledger triggers, and conversation association index/column. It rejects synthetic billing SQL and confirms no `billing_*` tables/triggers were created. This demonstrates only that the selected SQL is internally coherent.

**It does NOT apply migrations to production, copy a production database, create a Cloudflare D1 migration record, make a backup, inspect real user data, or prove production safety.** In particular, it does not authorize skipping migration tracking, marking financial SQL applied without execution, bypassing `scripts/check-production-migration-isolation.mjs`, or running `d1 migrations apply` on the main shared directory.

Actual production pending list from read-only GitHub Actions run [#44912959060](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44912959060) is `0012, 0013, 0014, 0015, 0016`. Synthetic billing files `0013–0015` are not authorized for production.

Before any migration release, obtain a verifiable D1 Time Travel bookmark and a reviewed restore plan, independently approve an **isolated, versioned, tested migration package**, and establish R2/Queue privacy, cost and Reader-preserving security gates. The owner must explicitly approve production SQL execution.

This proof is also not a substitute for eventual image credits/OpenAI project billing verification. 

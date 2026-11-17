# BOR AI Stage 3 — disposable D1 journal and billing proof

**Status: proposed, not executed remotely, no paid launch approval.** This runner is isolated from production and makes no paid AI or payment calls.

## Non-negotiable isolation

- The earlier Stage 2 database bor-ai-billing-sbx-stage2-clean-01 has synthetic test data. NEVER reuse or wipe it to run Stage 3.
- For remote testing, founder must create a **brand-new empty** D1 database named like bor-ai-billing-sbx-stage3-proof-01 in the dedicated Cloudflare sandbox account. Use a separate, narrowly scoped sandbox-only D1 token.
- Runner compares name plus UUID against Cloudflare D1 inventory and refuses production D1 name/UUID from wrangler.jsonc.
- The remote test only accepts a new, empty application schema (Cloudflare internal _cf_KV is the sole exception). Unlike Stage 2, Stage 3 cannot resume a half-migrated or previously populated DB.
- It creates a temporary Wrangler config, never loads the production config for D1 execution, never creates/deletes a remote database, and only deletes local temporary files.
- Owner must authorize a later remote dispatch. Neither this document nor any passing local CI automatically launches the remote test.

## Configuration in GitHub billing-sandbox environment

| Key | Type and requirement |
| --- | --- |
| BOR_AI_D1_SANDBOX_TOKEN | Existing dedicated sandbox secret; never paste into chat or source |
| BOR_AI_D1_SANDBOX_ACCOUNT_ID | Existing sandbox account variable |
| BOR_AI_D1_STAGE3_DB_NAME | NEW stage3-specific database name variable |
| BOR_AI_D1_STAGE3_DB_ID | NEW stage3-specific D1 UUID variable |

These Stage 3 DB variables are deliberately different from the Stage 2 DB vars, preventing accidental use of the existing populated Stage 2 database.

## Local rehearsal before any remote approval

From the feature branch checkout, run:

    node tests/billing/stage3-d1-proof.mjs --local

This is run by isolated D1 pull-request CI with no Cloudflare token and is sequential, not remote-concurrency evidence.

## Future restricted remote run — manual only

After independent code review, new empty database creation and founder authorization:

    node tests/billing/stage3-d1-proof.mjs --remote

A proposed GitHub workflow for future review must be manual workflow_dispatch only, use billing-sandbox environment, and pin one immutable reviewed commit. No automatic trigger, production deploy, migrations or payments are authorized.

The test applies the exact SQL migration files 0012_credit_ledger.sql, 0013_provider_spend_budget.sql and 0014_provider_usage_journal.sql only to the verified disposable database. It checks exact full schema matching and zero rows after each import. It exercises a 519 micro-USD measured synthetic debit, event journal ordering and immutability, duplicate replay denials, two held unknown-usage reservations, provider and global spend caps, and wallet concurrency. Remote mode runs eight independent concurrent SQL requests per cap; local mode runs them sequentially.

**Failed or interrupted remote runs may leave synthetic data. Never delete, reset, or reuse that database for a new fresh proof; request a new authorized empty sandbox database.**

## Not proven

- Real Cloudflare Workers AI usage and billing, provider invoices, paid tool costs, or any approved customer tariff.
- Actual JavaScript adapters executing against remote D1: remote mode verifies the same three SQL schema/trigger invariants with Wrangler, while integration of the actual JavaScript adapter functions is proven separately in local SQLite tests.
- Crash/retry recovery across calls, authenticated Worker and multi-agent routes, privacy and security approvals, Midtrans production payment lifecycle, or launch readiness.

Log a run URL, test commit, database UUID/name, concurrency counters, anomalies, independent reviewer and founder signoff before declaring this gate complete. Keep PR #245, #254 and #255 unmerged; production billing remains disabled.
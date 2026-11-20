# BOR AI — Production chat D1 migration guard (NO LIVE BILLING)

## Risk

`wrangler.jsonc` binds production `DB` to `bor-ai-chat` using the `migrations/` directory. That directory currently includes **synthetic-only billing SQL** files `0013_billing_foundation.sql`, `0014_billing_invoice_reference_guard.sql`, and `0015_billing_sandbox_invoice_recovery.sql`. They have deliberately NOT been approved to run against live customer chat data. Selecting `apply_db_migrations=true` in the manual production deploy workflow without a guard would ask Wrangler to apply pending migrations, potentially including these synthetic financial tables.

## Fail-closed safeguard

The manual production deploy workflow now runs `node scripts/check-production-migration-isolation.mjs migrations` **before** any remote `d1 migrations apply` step, but only if the operator explicitly requests migrations. This scans local SQL filenames and contents for reserved financial/billing identifiers; it rejects the entire migration dispatch when such SQL exists, without accessing or modifying Cloudflare.

The file is intentionally present today, so any migration dispatch while it remains present is **blocked**. Normal production deployment without migration (the workflow's default) is not blocked by this guard. A future fully authorized team must isolate and review the synthetic billing migrations in a separate nonproduction database, verify the actual pending migration list, take and validate D1 rollback bookmarks and then approve a separate release. Do not delete or rename migrations merely to bypass the scanner; that requires review of D1's migration history first.

## Tests

`node --test tests/production-migration-isolation.test.js`

The tests assert currently checked-in files are blocked; nonfinancial chat-only SQL could pass; renamed/misleading financial SQL is detected; empty input fails closed; and the production dispatch workflow invokes the scanner before the remote apply command.

## Scope

No new remote migration, D1 query, Cloudflare operation, payment, credit grant or production deploy was performed by this change. This is a production safety control while payments, provider metering and merchant approval remain P0 blockers. It is **not** a substitute for a security review or permission to enable live billing.

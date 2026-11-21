# BOR AI — Image-only D1 migration listing (no writes)

**Status: READ-ONLY INVENTORY. NOT APPROVAL TO APPLY.** Production URL Reader stays active, paid images remain off, and this utility makes no remote database, Worker, billing or OpenAI calls.

## Verified baseline

The [21 November 2026 production audit](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44912959060) found five pending files in production primary D1 bor-ai-chat:

- 0012_image_jobs.sql — image wallets/jobs/credit reservation triggers.
- 0013_billing_foundation.sql — unapproved synthetic finance schema.
- 0014_billing_invoice_reference_guard.sql — unapproved synthetic finance guard.
- 0015_billing_sandbox_invoice_recovery.sql — unapproved sandbox-only recovery.
- 0016_image_chat_history.sql — account-owned chat/image associations.

**Never run blanket Wrangler D1 apply against the original migrations/ directory.** The existing production deployment guard correctly blocks the synthetic billing files.

## Generated listing-only configuration

Run the following locally or in the approved read-only GitHub workflow:

    node scripts/prepare-image-only-migration-list.mjs

This produces two byte-identical copies (0012 and 0016 only) under .wrangler/image-only-migrations/, and a Git-ignored wrangler.image-only-migrations.generated.jsonc file with the existing pinned D1 binding. It deliberately excludes Worker main, assets, secrets, paid flags, R2 and Queue resources. Generation rejects unexpected directory entries, modified source SQL, unexpected database identity, and financial content.

The CI workflow runs these **read-only** commands:

    npx --yes wrangler@4 d1 migrations list bor-ai-chat --remote --config wrangler.jsonc
    npx --yes wrangler@4 d1 migrations list bor-ai-chat --remote --config wrangler.image-only-migrations.generated.jsonc

The first lists all pending migrations. The second lists only pending 0012 and 0016. Neither applies SQL, deploys a Worker, provisions a resource, or contacts an image model.

## Release prerequisites remain open

Before any schema change, verify the exact primary D1 identity, recorded migration history, Cloudflare Time Travel restore bookmark, rollback/forward-fix plan, and independent review. Do not rename source migration files, mark unapproved billing migrations as applied, or manually execute SQL. R2 privacy, Queue provisioning, provider access, pricing and spending caps still need approval and verification.

Production rollout must preserve the active Tavily URL Reader; security issues [#156](https://github.com/muhriskiawan23/ai-command-center/issues/156) and [#351](https://github.com/muhriskiawan23/ai-command-center/issues/351) remain open.

For migration directory support, see [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/reference/migrations/).

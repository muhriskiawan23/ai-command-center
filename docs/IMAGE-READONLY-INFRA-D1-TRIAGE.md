# BOR AI — image launch blockers and safe D1/R2 verification

**Status: NOT LIVE.** Do not mistake merged chat-first code or a successful read-only workflow for commercial image activation.

## Grounded evidence (21 November 2026)
The production read-only audit [run #44910665028](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44910665028) verified a healthy active Worker, the already-active Tavily URL Reader, `BOR_IMAGES_ENABLED=false`, missing active Worker `OPENAI_API_KEY`, `IMAGE_FILES` and `IMAGE_QUEUE` bindings, an absent dedicated image Queue, and no deployed `/media-lab.html`. The dedicated R2 bucket **could not be verified**, which must not be reported as absent.

The follow-up audit adds enumerated *no-secret* R2 status codes (`ok`, `denied`, `not_found`, `http_error`, `unexpected_shape` or `unverifiable`) and verifies metadata for only the D1 UUID/name pinned in `wrangler.jsonc`. It never reads user rows. Authentication and billing credentials are not logged.

## D1 migration isolation and rollback proof

**Remote production has not been migrated.** Read-only [run #44912959060](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44912959060) verified the pinned `bor-ai-chat` identity, R2 audit access denied, and all `0012–0016` previously pending. This was before the source-tree migration isolation change.

The reviewed source-tree layout is now proposed as:
- `migrations/0012_image_jobs.sql` — image wallet, jobs, credit reservation/refund triggers.
- `migrations/0016_image_chat_history.sql` — nullable image-to-conversation association.
- `staging/billing/synthetic-reference/0013_billing_foundation.sql`, `0014_billing_invoice_reference_guard.sql`, and `0015_billing_sandbox_invoice_recovery.sql` — **same SQL files retained only for offline synthetic tests**, never part of production chat migration discovery.

The original `0001–0011` chat migrations remain untouched. `scripts/check-production-migration-isolation.mjs` remains part of the production workflow and **must not be disabled**. Tests verify the billing SQL is absent from the production migration folder, the D1 image triggers/foreign keys initialize without billing tables, and synthetic billing tests use staging fixtures.

A second fail-closed preflight, `scripts/verify-d1-image-migration-rollback.mjs`, runs **only when** an operator explicitly dispatches `apply_db_migrations=true`. It verifies the pinned D1 identity, requests a current Cloudflare Time Travel bookmark through **GET only**, and records UTC pre-migration time plus a bookmark fingerprint (not the full bookmark). No SQL is executed by the preflight; missing or unsupported Time Travel prevents migration.

**Important:** Time Travel restoration is destructive and may discard user messages created after that point. Cloudflare's documented retention is 7 days (Free) or 30 days (Paid). A verified bookmark is a necessary preflight, not approval to apply migrations. The operator must review the exact remote pending list, user impact, and rollback procedure before any apply.

Do **not** apply D1 migrations remotely as part of this code-only PR. Source-tree separation does not mean production tables already exist.

## R2 and Queue release order
1. Confirm current Cloudflare account context and API permissions using the status-only R2/Queue probes; keep missing permissions separate from absent resources.
2. Before creating resources, review the private bucket `bor-ai-images`, 7-day `images/` cleanup, no `r2.dev` public domain, no public custom domains, and queue `bor-ai-image-jobs`; confirm operational/billing implications.
3. Independently review and explicitly approve any resource creation, D1 migration, or secret installation. Such actions are **not** part of this read-only audit.
4. Keep the current production URL Reader enabled until issue [#351](https://github.com/muhriskiawan23/ai-command-center/issues/351) and upstream SSRF/redirect control issue [#156](https://github.com/muhriskiawan23/ai-command-center/issues/156) are resolved or independently risk-accepted.
5. A safe *local-only Media Lab* release is separate from the paid image pilot. The existing Reader-preservation release workflow intentionally disallows paid image activation in the same dispatch.
6. Revalidate currently supported OpenAI image models, account eligibility, API Platform credit balance, actual costs, price-to-credit margin, spend ceiling, and the owner-authorized one-call pilot before enabling `BOR_IMAGES_ENABLED=true`.

## No-go checklist
Do not announce "Image Assistant live" while **any** of the following remain: unverified D1 migration/rollback, unpublished Media Lab assets, absent R2/Queue bindings, unknown R2 privacy, missing OpenAI Worker secret, Reader release/security gate unresolved, or pilot billing unverified.

All audit calls are GET-only except Wrangler's documented **read-only migration listing**; no Cloudflare deploy, D1 migration apply, provider inference, Queue writes, or R2 creation occurs.

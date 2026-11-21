# BOR AI — image launch blockers and safe D1/R2 verification

**Status: NOT LIVE.** Do not mistake merged chat-first code or a successful read-only workflow for commercial image activation.

## Grounded evidence (21 November 2026)
The production read-only audit [run #44910665028](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44910665028) verified a healthy active Worker, the already-active Tavily URL Reader, `BOR_IMAGES_ENABLED=false`, missing active Worker `OPENAI_API_KEY`, `IMAGE_FILES` and `IMAGE_QUEUE` bindings, an absent dedicated image Queue, and no deployed `/media-lab.html`. The dedicated R2 bucket **could not be verified**, which must not be reported as absent.

The follow-up audit adds enumerated *no-secret* R2 status codes (`ok`, `denied`, `not_found`, `http_error`, `unexpected_shape` or `unverifiable`) and verifies metadata for only the D1 UUID/name pinned in `wrangler.jsonc`. It never reads user rows. Authentication and billing credentials are not logged.

## D1 migration blockade
The checked-in `migrations/` directory includes:
- `0012_image_jobs.sql`: image credit wallet, jobs, triggers.
- `0013_billing_foundation.sql`: synthetic-only financial schema and triggers.
- `0014_billing_invoice_reference_guard.sql`: synthetic billing guard.
- `0015_billing_sandbox_invoice_recovery.sql`: sandbox-only invoice recovery.
- `0016_image_chat_history.sql`: nullable conversation association for images.

**Do NOT run `wrangler d1 migrations apply bor-ai-chat --remote` with this entire directory.** Image migrations are interleaved with unapproved synthetic billing migrations. Existing `scripts/check-production-migration-isolation.mjs` deliberately blocks this. Do not disable it, do not mark billing migrations applied without actually applying them, and do not copy/paste image SQL into production manually.

The Cloudflare API endpoint `GET /accounts/{account_id}/d1/database/{database_id}/time_travel/bookmark` can confirm a restoration bookmark exists for the pinned production DB. The read-only audit checks this with an authenticated **GET** and returns only `available`, `unavailable` or an unverified status; **it never logs, stores or exposes the bookmark value**. Bookmark availability is a safety prerequisite, **not** permission to restore or migrate. Reference: https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/

The read-only workflow runs **`wrangler d1 migrations list` only** to determine what the production D1 thinks is pending. The exact target D1 identity and a valid Cloudflare D1 Time Travel restoration bookmark must be confirmed before any future narrowly scoped schema change. If the listing or metadata probe fails, report it as unverified; do not infer absent tables.

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

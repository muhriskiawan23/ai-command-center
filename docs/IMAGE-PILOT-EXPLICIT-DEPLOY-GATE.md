# BOR AI Image Pilot — explicit no-provision production deploy gate

**Status: design/code gate, NOT a live release authorization.** No resource, database, Worker or OpenAI call is made by this document.

## What changes

The ordinary manual `BOR AI production deploy` workflow previously called `scripts/provision-image-resources.mjs` as soon as the production variable `BOR_IMAGES_ENABLED=true` was present. That provisioner can **create** `bor-ai-images`, **write** R2 lifecycle rules and **create** `bor-ai-image-jobs`. Those are account mutations and may incur costs. A seemingly ordinary Worker deploy must not silently make them.

The workflow now refuses an image-enabled deploy unless **both** are true:

- `BOR_IMAGES_ENABLED=true` is deliberately configured in the `production` environment after owner security and price review.
- The manual dispatch sets `enable_image_pilot=true` **and** provides `image_pilot_confirmation=CONFIRM_BOR_AI_IMAGE_PILOT_RELEASE` (in addition to the normal production environment approval).

A dispatch cannot also apply D1 schema, enable billing shadow or run live Tavily smoke while switching on paid images. The existing URL Reader preservation guard remains active and may independently refuse the deployment. This workflow must **not** be used to shut down the active Reader just to bypass image launch security review (#156, #351).

## What the release verifies, but never creates

`scripts/verify-image-resource-preflight.mjs` makes only Cloudflare API **GET** requests, checks exact account-scoped resource names, and fails closed unless it can prove:

- Existing R2 bucket `bor-ai-images` is present.
- Its managed `r2.dev` domain is disabled and there are no custom domains.
- Exactly one enabled `bor-image-retention` lifecycle rule removes objects under `images/` at age 7 days.
- Exactly one `bor-ai-image-jobs` Queue is discoverable with complete bounded inventory pagination. Any permission-denied/incomplete response blocks the release.

For R2 it uses the optional read-only `CLOUDFLARE_R2_AUDIT_TOKEN` if available, otherwise the regular Cloudflare token. Its output contains only verified booleans, retention age and zero-mutation counts; no secrets, user records, private images or provider response bodies are printed.

Then the workflow generates **local** isolated image migrations listing and performs a **read-only** remote D1 migrations list. `--expect-none` must pass: image migrations `0012_image_jobs.sql` and `0016_image_chat_history.sql` must already have been applied through an **independent, owner-approved database-only release**. The ordinary Worker deploy must never apply these migrations as part of paid image activation.

`scripts/provision-image-resources.mjs` remains available for a separately approved operator provisioning task, but it is not invoked by the ordinary production deployment.

## Requirements still outstanding

This gate is **not** a complete public launch decision. Operators must independently review the real provider/project spend ceiling, image tariff margins, source retention and account deletion, Cloudflare R2/Queue permissions, live D1 rollback evidence, secret installation, user notice/privacy and active Reader compatibility. `BOR_IMAGES_ENABLED=false` remains the source/default behavior.

In particular, the current checked-in Worker baseline has URL Reader disabled while production was last observed with Reader enabled. A proposed deploy that would turn it off is blocked unless independently reviewed; do not assume these settings are reconciled or the Image Assistant is live.

## Testing

Synthetic Node tests mock Cloudflare and exercise private/public R2 domains, lifecycle exact match, denied or missing resource responses, incomplete Queue pagination, confirmation gates, and a GET-only verifier. No actual Cloudflare, R2, D1 or OpenAI calls occur in the tests.

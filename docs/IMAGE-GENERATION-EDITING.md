# BOR AI image generation and editing — current launch/runbook

**Status (2026-11-22): source implemented; paid Image Assistant NOT LIVE.** This is documentation, not authorization to spend API credits, modify production D1, enable images, or deploy a Worker. Keep existing production URL Reader functioning. See [pilot controls](OPENAI-IMAGE-PILOT.md), [explicit image deploy gate](IMAGE-PILOT-EXPLICIT-DEPLOY-GATE.md), [image-only D1 release](IMAGE-ONLY-D1-MANUAL-RELEASE.md), and [Reader-preserving release](READER-PRESERVING-MEDIA-RELEASE.md).

## User experience and supported inputs

Users can ask to generate/edit images from a prompt or use the image tools. Questions *about* an image remain in chat/vision, not a paid image job. Originals for edit are JPG/PNG/WEBP up to 5 MiB; they are submitted only after user consent. Image outputs are currently **1024×1024 only** (PNG, JPEG, WEBP), with **low** pilot quality, not arbitrary portrait or landscape dimensions. High-definition edits can change visual details. No guarantees of exact text, pixel-perfect upscaling, PDF export, masks, or precise social-story dimensions.

Authenticated previews/downloads, repeat/edit actions, job history and per-conversation association are implemented in source. This is **not** evidence that the Media Lab assets, bindings or OpenAI provider processing have been deployed.

## Image API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/images/config` | Public disabled/enabled status, exact pilot constraints and tariff; no secrets |
| `POST /api/images/jobs` | Authenticated, same-origin, versioned-credit quote, reserve and queue |
| `GET /api/images/jobs` | Own latest 50 jobs and image-credit balance |
| `GET /api/images/jobs/:id` | Owned job status/metadata |
| `DELETE /api/images/jobs/:id` | Owner delete and erase source/output metadata |
| `GET /api/files/:id/preview` | Authenticated private preview |
| `GET /api/files/:id/download` | Authenticated private file download |

Submission requires a UUID `requestId`, `mode` generate/edit, a nonempty `prompt` (up to 4,000 characters), `outputFormat` png/jpeg/webp, `size=1024x1024`, and a matching `tariffVersion` / `maxCredits`. Edit requires an uploaded image or one owned previous result; arbitrary remote image URLs are not accepted.

## Safety, retention and cost controls

- R2 objects are private, stored under `images/`, and use a seven-day `bor-image-retention` bucket lifecycle. Lifecycle expiration is asynchronous and **does not erase prompts or job metadata in D1**. The scheduled cleanup removes expired source/output objects, erases expired prompts, and handles stale jobs. **Pausing paid generation must preserve D1/R2 bindings and the cleanup cron**; `cleanupImageJobs` also runs when `BOR_IMAGES_ENABLED=false` if those bindings remain present (PR #377).
- D1 image schema is **0012** (`image_jobs`, wallets, atomic ledger reserve/refund, durable pilot meter) and **0016** (nullable conversation association). Neither migration is yet applied to the production `bor-ai-chat` database. Image wallets are independent of subscription/chat quota/billing; no payment-triggered image credits are live.
- Only job IDs are sent on the dedicated `bor-ai-image-jobs` Queue. Claimed jobs must never retry an already-started provider call. Provider-billing uncertainty pauses future attempts until reviewed; failure refunds image credits but does not imply zero OpenAI cost.
- Configured pilot model is `gpt-image-2` at `quality=low`, one 1024×1024 output/job, one user job/day, two jobs/day globally, and an operator-set **1–10 lifetime job admission cap**. Availability, account eligibility, actual provider prices and exact USD exposure **must be independently verified**. This is an attempt cap, **not a monetary hard cap**; protect the OpenAI account with separate spending controls and automatic recharge disabled.
- Private downloads require an authenticated, owning user; image output is not served through a public `r2.dev` URL or custom bucket domain. Never print API keys, prompts, provider error bodies or private images into CI logs.

## Production preparation order — owner/security gates

1. **Already verified read-only (2026-11-22):** existing `bor-ai-images` bucket, no public R2 domains, and dedicated `bor-ai-image-jobs` Queue ([readiness audit attempt 8](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44933803400)). Owner-provided dashboard state shows enabled `bor-image-retention` rule scoped to `images/` and seven days. The separate `scripts/verify-image-resource-preflight.mjs` can GET-check the exact lifecycle/Queue criteria before a future release. Never provision, expose, or alter these resources implicitly during normal deployment.
2. **Database review only:** image-only manual workflow `.github/workflows/bor-ai-image-d1-release.yml` **`phase=plan`** passed on [run 44986999616](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44986999616), confirming exactly the two pending image migrations, no synthetic billing SQL, and current Time Travel bookmark. This did **not** apply SQL. `phase=apply` needs **separate explicit owner/security approval**, production data/impact review and a tested, operator-controlled recovery plan. A bookmark *fingerprint* in CI cannot be used for restoration; Time Travel restore may destructively erase newer chats. Do not couple D1 migration to normal Worker deployment.
3. **Preserve the production Reader:** current deployed URL Reader is ON, but `main/wrangler.jsonc` has `URL_READER_ENABLED=false`. **Never perform an ordinary production Worker deployment**, including to publish Media Lab, without verifying active Worker settings and an independently approved Reader-preserving workflow. Issues [#351](https://github.com/muhriskiawan23/ai-command-center/issues/351) and [#156](https://github.com/muhriskiawan23/ai-command-center/issues/156) remain open. Keep browser automation out of the image release.
4. **Secret, tariff and payment review:** owner verifies OpenAI API Platform credit, org/model eligibility, rates and separate spend ceiling before installing `OPENAI_API_KEY` as a **Cloudflare Worker secret** (never GitHub plaintext variables, JS frontend or chat). Review `IMAGE_CREDITS_GENERATE`, `IMAGE_CREDITS_EDIT`, `IMAGE_TARIFF_VERSION`, and `IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT` (1–10). No automatic image-credit grant, checkout, top-up, or OpenAI paid smoke is approved by this guide.
5. **Separate paid pilot dispatch, only after gates above:** the manual `BOR AI production deploy` workflow requires `BOR_IMAGES_ENABLED=true` in its approved production environment, explicit `enable_image_pilot=true` and exact `image_pilot_confirmation=CONFIRM_BOR_AI_IMAGE_PILOT_RELEASE`. It **verifies**, but does not create, R2/Queue/lifecycle. Run with `apply_db_migrations=false`, `enable_billing_shadow=false`, `run_tavily_smoke=false`, and an independently approved Reader-preserving selection. Never interpret an image-enabled flag by itself as consent for paid provider work.
6. **Post-release verification:** verify active binding names `IMAGE_FILES`, `IMAGE_QUEUE`, `OPENAI_API_KEY` (not secret values), Media Lab assets, URL Reader continuity, private download ownership, and D1 history. Only after the owner's separate consent, run at most one bounded, chargeable pilot image request and reconcile OpenAI provider-side usage. Expand generate/edit tests and public availability only after confirmed economics and privacy.

## Pausing, recovery, and non-goals

Pausing Image Assistant must block **new paid jobs** while retaining storage bindings, schedules and access to previously generated files until their retention expires. Do **not** use an unreviewed disabled-baseline deployment to pause the pilot: it could remove image storage/cleanup bindings and **turn off the active URL Reader**. Cloudflare R2 lifecycle is only an object-store backstop. If a post-release issue occurs, halt additional paid dispatch, inspect outstanding `image_pilot_meter` state, preserve evidence and follow the reviewed rollback procedure; do not blindly restore a production D1 bookmark.

Offline SQLite and Playwright tests use a synthetic image provider and never demonstrate live OpenAI compatibility or production readiness. This document must not be treated as authorization for a production migration, deployment, financial transaction or external user-content transfer.

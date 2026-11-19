# BOR AI image generation and editing

Implemented MVP, disabled until production setup is complete. This is not evidence of a live OpenAI image call or commercial payment integration.

## User experience

Automatic prompt detection or explicit Alat → Buat gambar / Edit foto. Questions such as “Ini foto apa?” still use vision. “Bagaimana cara membuat poster?” stays in chat. The image dialog discloses OpenAI processing, versioned credit cost, output size/format and retention before submission. JPG/PNG/WEBP originals (up to 5 MiB) remain in volatile browser state until submission; editing does not use the smaller JPEG prepared for vision.

Queued/processing jobs display in chat; Gambar saya restores the newest 50 jobs after reload. Completed cards support preview, authenticated download, edit again, variation, regenerate and deletion. PNG, JPEG and WEBP are supported. Portrait is 1024×1536, not an exact 9:16 Instagram Story template. PDF export, pixel-preserving super-resolution, region masks and exact layout templates remain future work. “HD” uses generative editing and can alter details.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/images/config` | Public availability, tariff, fixed sizes/formats; no secrets |
| `POST /api/images/jobs` | Session + same-origin + rate limit; reserve credits and enqueue |
| `GET /api/images/jobs` | Owner's last 50 jobs and image-credit balance |
| `GET /api/images/jobs/:id` | Owner's status and output metadata |
| `DELETE /api/images/jobs/:id` | Delete completed/failed output and erase prompt |
| `GET /api/files/:id/preview` | Private inline image |
| `GET /api/files/:id/download` | Private attachment download |

POST fields: `requestId` (UUID), `tariffVersion` and `maxCredits` (must match current quote), `mode` (`generate`/`edit`), `prompt` (1–4000 chars), `outputFormat` (`png`/`jpeg`/`webp`), `size` (1024×1024 / 1024×1536 / 1536×1024). Edit requires exactly one `sourceImage` (base64 data URL) or owned completed `sourceJobId`. No arbitrary remote source URLs. Unavailable images receive an explicit feature-status notice rather than fabricated image results from a text model.

## Reliability, money and privacy

D1 migration 0012 adds jobs, image wallets and a credit ledger. Database triggers reserve credits atomically on job creation, reject insufficient funds, and refund once on failure. Idempotency is per account/request UUID and a hash of normalized inputs. Changed payloads with the same ID return 409. Job IDs are checked against the signed-in owner on every status, download, reuse and delete request.

Cloudflare Queue messages contain only job IDs. A compare-and-set `queued → processing` claim allows at most one paid invocation. Duplicate deliveries never regenerate a claimed job. A provider timeout is ambiguous: no automatic paid retry; customer credits are refunded and the founder may still incur provider cost. Daily attempt caps (3/account, 20/global by default), concurrency 2, medium quality and fixed sizes bound exposure. These are attempt controls, not a guaranteed USD cost ceiling. Failed attempts still count for daily caps.

Store measured input/output/total token usage when returned. No claim that missing usage means zero cost. Image credits are a separately funded wallet; existing Basic/Pro chat prices, payment flows and chat quotas are untouched. Subscription/top-up payment settlement must later issue idempotent ledger grants after verified payment. No public credit-grant endpoint or free automatic balance exists.

Use `node scripts/image-credit-grant.mjs USER_ID CREDITS UNIQUE_REFERENCE > image-credit-grant.sql` to prepare reviewable, idempotent founder grants. Apply the SQL using the existing D1 operator process. The script does not execute money movement. Never grant test credits to a customer based only on an unverified payment event.

R2 is private: no r2.dev URL or custom public domain. Worker downloads require session ownership and use `private, no-store`, `nosniff` and attachment headers. Provider requests go only to the fixed OpenAI Images endpoints with redirects rejected. Original edit sources are deleted after terminal processing; interrupted work is failed/refunded after 15 minutes by a 10-minute cron. Output access expires after seven days. Cron erases prompts/files in batches of 100; R2 lifecycle provides a seven-day orphan-object backstop (physical lifecycle deletion is asynchronous). D1 user deletion cascades image metadata; R2 objects then age out under lifecycle. Logs do not contain raw errors, keys, prompts or pixels. Provider retention follows the configured OpenAI account terms; the app's seven-day policy describes BOR storage.

## Activation and deployment

1. Apply reviewed migration `0012_image_jobs.sql` with the existing production migration process and capture a D1 recovery bookmark first. Run the production workflow with `apply_db_migrations=true` only after review.
2. Configure `OPENAI_API_KEY` as a **Cloudflare Worker secret**, using an OpenAI account with image-model access and billing. Do not put keys in source, GitHub variables or chat. Default image model is `gpt-image-2.5-sunburst`; the runtime variable can be changed after model/cost validation.
3. Set GitHub repository variables `IMAGE_CREDITS_GENERATE`, `IMAGE_CREDITS_EDIT` to reviewed positive integer costs, and `IMAGE_TARIFF_VERSION` to a stable rate version. Validate the USD value of credits against observed API costs before commercial sales. Example values in tests are synthetic, not approved prices.
4. Set repository variable `BOR_IMAGES_ENABLED=true`, then run the existing **BOR AI production deploy** workflow. Its image branch validates the generated config, verifies the Worker secret name, provisions the dedicated R2 bucket and queue, confirms the image triggers exist, and deploys bindings/cron. Cloudflare token needs R2, Queues, Workers and D1 permissions. Resource provisioning rejects public bucket domains.
5. Grant bounded internal-test image credits using the reviewed SQL. Perform one real generation, one uploaded-image edit, download both files, reload the gallery and verify ledger/usage. Local/CI provider stubs are not evidence of live provider access or image quality.

Routine releases read the same repository variables so enabled image bindings survive deployments. The standard `wrangler.jsonc` is deliberately disabled and remains the rollback config. Setting `BOR_IMAGES_ENABLED=false` in repository variables and redeploying turns off paid submissions; preserved D1/R2 records are not deleted. Pausing submissions alone can also be done by setting the Worker flag false while retaining bindings, allowing private downloads until expiry. Do not use the disabled baseline deployment if you intend to keep gallery/download bindings active during an incident.

## Validation

Real SQLite with production migrations verifies reservation/refund, request replay, cross-account isolation, source byte forwarding, failed queues, stale recovery and file expiry. Playwright tests exercise generation → preview → download → reload gallery → edit on mobile and desktop using a deterministic image provider, plus guest and disabled-feature paths. No test spends provider money.

API references checked during implementation:

- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.cloudflare.com/queues/configuration/configure-queues/
- https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/update/

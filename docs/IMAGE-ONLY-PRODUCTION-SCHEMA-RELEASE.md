# BOR AI — isolated image-only production D1 schema release

**Status: workflow source only; no migrations applied, Worker deployed, images enabled or paid provider calls made.**

The production chat D1 is bor-ai-chat. The image-only migration pair is:
- 0012_image_jobs.sql: image wallet/jobs, private object metadata, debit/refund triggers, lifetime provider attempt meter.
- 0016_image_chat_history.sql: nullable image-to-conversation reference and index.

These are additive schema changes. Do not use in-place D1 Time Travel restore as a rollback; it can erase conversations written after the bookmark.

The new manual workflow is **BOR AI image-only D1 schema release (no Worker deploy)**.
Start it from main with apply_image_schema=false to inventory exact pending SQL. It
performs an offline migration proof, checks for billing/sandbox contamination,
pins the production database ID, and refuses any pending migrations other
than the exact two-image pair. This read-only mode cannot change D1 or
activate image generation.

Only after a separate review, open an independently approved production
environment workflow dispatch and set apply_image_schema=true with the
exact owner confirmation APPLY_IMAGE_SCHEMA_BOR_AI. The guarded workflow:
1. Runs offline image SQL checks, verifies the exact pending pair, and obtains
   a read-only D1 Time Travel bookmark fingerprint (no restore).
2. Applies **only** the two files from the generated image-only migration
   directory to the pinned existing production D1.
3. Re-reads the pending list, requires none remain, verifies the image
   tables/triggers/indexes and the conversation association column.
4. Does not switch a Worker version, change the active URL Reader, grant
   credits, call OpenAI, or activate a payment provider.

This is **not enough to turn Image Assistant on**. A later independent
image-only Worker release still needs the OpenAI credential present as a
secret, private R2 and Queue binding checks, reviewed per-image tariff and
provider cost caps, verified signed-in image credit policy and a pilot budget,
real provider testing under an owner-approved spend ceiling, and preservation
of the currently active URL Reader only after its safety gate #156/#351.
Do not call the image service live until these are demonstrated.

The isolation allows image schema failures to be addressed with a forward-only
repair instead of rewinding primary D1, preserving chat writes from after the
schema change. It does not protect against catastrophic primary D1 loss;
independent chat journal #382 remains necessary.

# BOR AI — independent private chat journal staging (P0 / not live)

**Status: isolated server-side storage implementation and synthetic proof only.**
The production Worker does not import, bind or invoke this Durable Object.
No Cloudflare resource was provisioned, no existing D1 chat data was moved, and
**RPO=0 / zero lost messages is NOT established**. This is a step toward #382,
not approval for a production restore or public launch.

## Design and safety boundary

- The source module src/chat-journal-do.js implements a SQLite-backed Durable
  Object intended for **one verified user per instance**. A future trusted
  Worker must choose the Durable Object via its own **server-verified session**.
  Never accept a browser-supplied user ID or namespace target.
- Its /append internal API requires a separate, non-public, 32+-character
  CHAT_JOURNAL_INTERNAL_SECRET. Missing/unmatched credentials fail closed.
  It returns a durable per-user sequence receipt and deduplicates event IDs
  with canonical payload comparison. No user content is logged.
- /read is an **internal-only** operator/rehydration interface that can return
  sensitive message text. It must NEVER be forwarded to browser/public routes.
  Before any staging use, review operator auth, rotation, access logging,
  KMS/encryption and least privilege.
- Chat/account deletion atomically redact earlier journal payload JSON.
  Metadata (event IDs, account/conversation IDs and tombstones) requires a
  separate retention/privacy policy. Older backups and replicas are NOT
  automatically erased.
- The journal is independent of **primary** bor-ai-chat D1. This does not
  provide an atomic transaction between stores or a recovery guarantee.
  A failed journal append must cause refusal of the saved acknowledgement.
  A committed journal followed by a failed D1 write must be reconciled
  idempotently, with deletion priority and no duplicate paid AI generation.

## Intentionally inert staging packaging

Local dry-run only:

    npm test
    node scripts/prepare-chat-journal-staging.mjs
    npx --yes wrangler@4 deploy --dry-run --config wrangler.chat-journal-staging.generated.jsonc

The script only writes a **local** Wrangler config. It never deploys.
The generated config uses a dedicated bor-ai-chat-journal-staging Worker,
a new SQLite Durable Object class and a public handler returning 404.
It excludes primary D1, image R2, Queue, billing, Tavily and production
Worker name. No secret values or public customer-chat routes are created.
Never deploy before independent cost/security approval and a separate
secret provisioning procedure.

## Required before any live cutover or RPO promise

1. Implement server-authenticated callers for all chat mutation paths,
   including login/account creation, messages and AI turns, edit/regenerate,
   pin/archive/title, feedback, delete-one/all and account deletion.
2. Map primary INTEGER message IDs to stable journal events, enforce request
   idempotency and account ownership, and prove exactly-once projection.
3. Secure independent storage and costs, encryption, backup/retention, user
   deletion, and uncompensated write failures. Protect read and append paths.
4. Backfill verified historical chat without exposing content to CI artifacts,
   logs, image R2 or temporary image Queue. Establish secure checkpoints.
5. Rehearse synthetic disaster recovery with missing D1/journal commits,
   duplicate deliveries, truncated head, gaps, deletion, concurrency and
   complete comparison of all acknowledged events.
6. Require separate owner approval, measured evidence and reviewed deploy
   gates before switching any production writer. Never use in-place D1 Time
   Travel restore as a routine rollback.

References:
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- https://github.com/muhriskiawan23/ai-command-center/issues/382

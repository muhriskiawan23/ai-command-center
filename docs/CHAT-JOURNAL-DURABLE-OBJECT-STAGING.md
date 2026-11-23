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

## Independent source-read and replay staging disaster drill (22 Nov 2026)

The new **tools/recovery/do-journal-staging-drill.mjs** consumes the actual
private Durable Object journal wire format. It is **offline/test only**.
It uses an independently verified minimum journal-head watermark, pages
private source records with a fixed `expectedHead`, rejects gaps, duplicate
IDs, invalid owner, missing tail, forged redactions and any changed source
head during multi-page reads. Deleted conversation payloads remain scrubbed;
redaction is only accepted when a later verified chat/account deletion exists.

A complete verified snapshot is projected into a **fresh synthetic SQLite
primary**, using the older independently tested recovery prototype for turn
replacement, feedback, account and chat tombstones. The test injects a
failure between a recovered message and checkpoint and verifies that a clean
restart replays without extra turns. Diagnostics return only event counts,
not user prompts or media. This is **not** a copy or export of customer data.

The Durable Object adds an optional `expectedHead` parameter to its private
/read endpoint, returning **409** if new data/deletion appears mid-snapshot.
This forbids mixing pre-deletion and post-deletion pages. No public route,
production D1 binding, chat writer or live replay endpoint was added.

Remaining production blockers: dedicated deploy and secured namespace, budget,
server-side verified account routing, full existing-chat backfill and accurate
ID mappings, deletion of earlier replicas/backups, complete receipt-based
acknowledgement/projection protocol, proof every mutation is covered, full
staging disaster drill against realistic D1 schema and **explicit owner
release approval**. No zero-loss claim is justified yet.

## 23 Nov 2026 — delete/replay integrity hardening (source-only)

The independent, **nonproduction** Durable Object journal and offline recovery
adapter were hardened for two previously uncovered crash/privacy windows:

- When `account.deleted` commits but its HTTP acknowledgement is lost, retrying
  the **same event_id and canonical empty payload** now returns the original
  durable sequence with `duplicate:true`, including after Durable Object
  recreation. All other writes (including stale messages or a second account
  deletion ID) remain blocked; redacted pre-erasure bodies never return.
- `conversation.deleted` must retain its **minimal conversation-ID-only
  tombstone** after a later `conversations.deleted_all`. The delete-all
  operation still atomically redacts earlier titles, prompts, answers, edits
  and feedback. Redacting the earlier delete command itself breaks a legitimate
  delete-one → delete-all → new-chat recovery sequence, because the replayer
  cannot establish the tombstone or owner. The new offline tests replay this
  exact sequence and a later account erasure from actual Durable Object pages.

This fixes the **synthetic journal/replay implementation only**. No deployed
Durable Object, protected production journal, live write path, SQL export,
backup restore or RPO guarantee is created by these tests. Before activation
we must additionally establish complete real production D1 mutation mapping,
chat backfill, independent storage costs/retention, exactly-once delivery,
session ownership, and a witnessed nonproduction recovery drill.

## 23 Nov 2026 — write-time message integrity and real-D1 ID mismatch

New source-only SQLite journal constraints reject invalid events **before**
acknowledging an append:

- Every string journal message ID is single-use, even after a replacement,
  conversation deletion, delete-all, or account deletion. Its relational
  admission ledger is written in the same DO SQLite transaction as the
  event and its durable sequence receipt.
- Feedback must reference an **active assistant** message in the same
  verified owner's conversation; missing, user-role or cross-conversation
  message IDs return a 409 with no journal row.
- Regeneration/replacement requires the two newest active messages to be
  the stated user/assistant pair, in that order. New IDs must never have
  been admitted before. A retry of an identical event ID uses the original
  durable receipt, not a second model invocation. Duplicate/reused IDs and
  stale replacements fail closed.
- Delete-one, delete-all and account deletion mark affected message IDs
  inactive while retaining minimal identity markers to block stale reuse.
  Sensitive earlier payloads are still redacted by the existing deletion
  transactions. These ID markers require separate metadata retention/privacy
  policy and replication/deletion review.

**Critical production compatibility gap:** actual
`migrations/0001_auth_and_chat.sql` stores `messages.id` as an
`INTEGER PRIMARY KEY AUTOINCREMENT`, while this journal uses stable string
message IDs. Real `answer_feedback.message_id` (migration 0007) and
`image_jobs`/conversation associations refer to actual D1 integer IDs,
and `messages.links_json` plus idempotency keys need preservation.
This source-only DO fix **does not map** those IDs or implement read-through,
D1 reconciliation, account/session history recovery, or historical backfill.
It is NOT wired into the live BOR AI Worker and cannot be deployed or used
to claim production zero-loss without explicit independent approval.

## 23 Nov 2026 — REAL core D1 schema replay proof, isolated in memory

`tools/recovery/replay-do-journal-to-real-chat-schema-offline.mjs`
now exercises private DO journal snapshots against **actual checked-in BOR AI
core chat migrations** `0001`, `0004`, `0005`, `0006`, `0007` and `0008`
in a brand-new, ephemeral SQLite database. It never has a Cloudflare D1
binding, production credentials, public API, storage cost, or access to real
users' data.

The offline projection maps each journal's stable string `message_id`
to the new SQLite `messages.id INTEGER PRIMARY KEY AUTOINCREMENT` using a
transactional private mapping table. It maps assistant-only feedback to the
correct new integer message ID, verifies foreign keys, replays chat create,
post-checkpoint turns, updates, replacement, deletion and account tombstones,
and writes its replay checkpoint in the **same** transaction as the projected
rows. A synthetic fault between message insert and checkpoint is rolled back
and a restart replays it only once. A shorter replay batch fails closed
instead of saying recovery is complete; a verified new journal head can be
applied on restart.

**Known limitations are encoded in the test receipt as false**:
`originalMessageIdsPreserved`, `originalTimestampsPreserved`,
`originalSessionsPreserved`, `originalLinksPreserved` and
`independentStorageBackfillProven`. Production links/idempotency keys,
Google sessions, memory, image foreign keys, complete schema drift and
historical data cannot be safely reconstructed from the existing minimal
journal schema. The user identity (including email/name) and synthetic
timestamp are supplied as **explicit offline test fixtures**, never
recovered or guessed for live users. This is a compatibility/failure proof,
not a full restore or authorization to deploy.

**Do not promote the projection into production** before real metadata,
original integer IDs and dependent table relationships, full D1 schema,
historic backfill and privacy/retention requirements are independently
validated and an owner-approved nonproduction disaster drill succeeds.

## 23 Nov 2026 — approved one-shot CLOSED Cloudflare staging release

The owner approved deploying a new **isolated, synthetic-only SQLite Durable
Object staging Worker** with potential small Cloudflare usage costs. This is
NOT permission to bind it to `app.getborai.com`, copy actual chat, backfill
users, deploy a production writer, or lift the third production D1 export lock.

- New Worker: `bor-ai-chat-journal-staging`; no primary D1, R2,
  Assets, API, scheduled events, or routes. Both `workers_dev:false` and
  `preview_urls:false` are explicitly required and rechecked with
  Cloudflare's GET-only API. Public fetch always returns 404.
- Private SQL Durable Object: `ChatJournalDurableObject` with existing
  `new_sqlite_classes` migration, stored under the NEW staging script.
  It receives no live user IDs or user chat.
- Internal manual Workflow:
  `bor-ai-chat-journal-staging-drill-v1`, exported as
  `ChatJournalSyntheticStagingWorkflow`, with no cron and no public
  trigger. A pinned one-shot owner-approved GitHub Actions deploy invokes
  exactly one synthetic Workflow instance using Cloudflare's authenticated
  CLI, not a public chat route.
- The workflow uses a random 80-hex-character secret generated privately
  in the GitHub runner and stored ONLY in this isolated Worker's
  `CHAT_JOURNAL_INTERNAL_SECRET`. It is never output in CI logs/artifacts.
  Account ID and scoped deploy credential are separately preflighted.
  The staging Worker can use a dedicated new secret without touching
  production Google, Midtrans, Tavily, D1 or backup tokens.
- The drill checks real Cloudflare DO storage: 10 fixed synthetic events,
  duplicate deletion retry after lost response, rejected stale write after
  conversation deletion, sequence/head readback, privacy deletion redacting
  all 9 earlier payloads, and no user content. Only safe counts and flags
  are reported. The per-instance DO name is synthetic and run-scoped.
- Each change remains protected by an exact parent SHA, exact squash title,
  unchanged current main, and exact reviewed file diff. This trigger must
  be removed immediately after the authorized run, even if the run fails.
  Any failed or incomplete creation must be diagnosed before separate
  approval of any further Cloudflare mutations.

**Staging success would NOT yet prove disaster recovery:** the existing
production chat Worker remains unjournaled, no customer chat is backed up,
and original integer IDs, full schema, timestamps, Google sessions,
attachments, privacy/backfill and production SQL export/restore remain open.
Do not claim production RPO=0 or ready-for-launch on this basis.

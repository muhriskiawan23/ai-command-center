# BOR AI — independent private chat journal staging (P0 / not live)

**Status as of 2026-11-23: CLOSED Cloudflare staging Worker DEPLOYED and
one live synthetic Durable Object journal drill PASSED.** The production
Worker still does not import, bind or invoke this Durable Object. No existing
production D1 chat data was moved or exported. **RPO=0 / zero lost
messages is NOT established**; this is an isolated test for #382,
not approval for production restore, application cutover, or public launch.

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

The script itself only writes a **local** Wrangler config and never
deploys. The owner separately approved and deployed a dedicated staging
Worker through protected one-shot GitHub Actions on 23 Nov 2026.
Its public handler returns 404, workers.dev and preview URLs are disabled,
and its new SQLite DO binding excludes primary D1, image R2, Queue,
billing, Tavily and the main production Worker. A random internal-only secret
was installed on this Worker by the deployment action; the value was
never disclosed in logs. The consumed automatic release trigger has been
deleted; future deployments require new approval and review.

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

## Live CLOSED Cloudflare staging deployment result — 23 Nov 2026

**Deployment and tested scope SUCCESS**, original GitHub Actions
[run #45111777925](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45111777925),
on exact source commit `7f5b97f37a0a9fdbd0cc20fd3a398a7860375596`.
Initial Wrangler version ID:
`a5a3f919-f681-49d5-aea5-e03850ec9815`;
the subsequent Worker secret-put may have generated a newer active version.
That initial ID must NOT be represented as the independently rechecked
post-secret active version.

- Cloudflare independently verified `workers.dev.enabled=false` and
  `previews_enabled=false`; there were no custom routes or public chat
  endpoints. Existing `ai-command-center` production Worker, `bor-ai-chat`
  D1 and backup Worker were unchanged.
- Separate `bor-ai-chat-journal-staging` Worker deployed using a new
  SQLite-backed `ChatJournalDurableObject` migration and the explicitly
  manual `bor-ai-chat-journal-staging-drill-v1` Workflow, without cron.
- Only one owner-approved internal Workflow instance,
  `bor-journal-synthetic-45111777925-1`, was triggered. Authenticated
  GET polling to the Cloudflare Workflow instances API verified status
  `complete`, returning a safe receipt:
  `passed:true`, `events:10`, `head:10`,
  `erasedPayloadEvents:9`, `duplicateDeletionRetriesVerified:2`,
  `staleMutationBlocked:true`, `independentSQLite:true`,
  `customerDataAccessed:false`, `productionD1Accessed:false`.
  Only predetermined fake chat markers were used, then removed from DO
  event payloads by account deletion; minimal non-content event IDs and
  tombstones persist in staging storage.
- Source CI for the reviewed release: 1,050 passed / 0 failed / 1
  skipped; Workflow gate's focused tests: 33 passed / 0 failed.
- The one-shot **deployment GitHub workflow** was retired immediately
  afterward in a cleanup PR. The internal staging Workflow definition
  remains deployed; it has no timer or publicly reachable route.

**What this proves:** deployed Cloudflare Durable Object storage can safely
accept/sequence a small synthetic user journal, authenticate internal
requests, enforce idempotent deletion, reject a stale write and redact
older message payloads. **What it does NOT prove:** journal-first writes
from actual BOR AI chat, original production ID retention, historic
backfill, per-user privacy/retention at scale, independent full-schema
restore, a successful production SQL export, a zero-loss RPO, or an
acceptable recurring cost budget. These require separately authorized
production work; P0 #382 stays OPEN. The third production D1 export
remains explicitly HARD LOCKED.

## 23 Nov 2026 — complete checked-in D1 schema fidelity drill (offline only)

`tools/recovery/full-schema-synthetic-sqlite-recovery.mjs` builds a
**new in-memory SQLite database** from **all 13** current repository
migrations (`0001`–`0012`, `0016`) and inserts strictly invented data
across login, sessions, conversations, messages, integer IDs, prompt/assistant
idempotency keys, citation links, feedback, memory, daily usage, public API
keys, GitHub OAuth records, search usage, image wallet/jobs/credit ledger and
pilot meter. The real image triggers execute, including credit reservation
and the non-resettable aggregate meter.

An actual SQLite **online backup copy** is written to a randomly named
temporary directory and reopened as a separate restored database.
The drill compares hashes of **every table row, full schema DDL,
indexes, triggers, and `sqlite_sequence`**, checks `PRAGMA integrity_check`
and `foreign_key_check`, verifies original message IDs and dependent
feedback/image references, and deletes the temporary file in a `finally`
block. Additional tests mutate one row and a foreign key to prove the
integrity gate fails, then demonstrate real cascading chat/account deletion
while protecting the operator-owned image pilot lifetime meter.

**Scope boundary:** This is an offline source/target SQLite file-copy
fidelity check, NOT the Cloudflare D1 SQL-export API, NOT a production
data backup, NOT proof of an independently retained journal, and NOT a
post-checkpoint recovery guarantee. The fully synthetic restored data can
retain original integer IDs precisely because it is a full-image copy; the
earlier minimal journal-only adapter CANNOT. A production full-schema
restore still requires an owner-approved real export and secure restore
rehearsal after fresh backfill, privacy/cost review and journal-first write
coverage. Do not deploy or unlock third production export from this result.

## 23 Nov 2026 — fail-closed live D1 write-surface inventory (source-only)

The **read-only** `node tools/recovery/audit-production-chat-journal-write-surface.mjs`
command inventories every SQL mutation literal referencing tracked
conversation-, account-, session-, dependent image-, memory-, developer-key-
and GitHub-OAuth-related tables across `src/*.js` (excluding any new writer
until it is deliberately reviewed). A strict manifest pins each known
`file × SQL action × table` and number of source literals: changing, removing
or introducing a writer breaks CI via
`tests/production-chat-journal-write-surface.test.js`. This
is a regression gate **against silent drift**, not proof of a journal.
The excluded `billing-staging-worker` records are explicitly counted
separately because that Worker has its own isolated D1.

The current reviewed inventory contains **58 primary application SQL
mutation literals**, with **0 currently connected to a production journal**,
plus **2 isolated billing-staging source literals**. These numbers are counts
of source SQL expressions, **not runtime queries, customer records or
unique HTTP endpoints**. Source spans that build SQL dynamically are covered
by their initial static SQL action; any dynamic SQL not containing the
tracked table/action text, indirect persistence helper, Workers binding
created outside `wrangler.jsonc`, or deployment change outside this
repository can still escape this specific static analysis. It is not a
formal whole-program proof.

Routes to close before enabling a production journal:

- Auth: verified Google owner creation/upsert, session rotation/cleanup
  and explicit logout. Never journal bearer cookies, tokens or key hashes
  into plaintext chat events; design separate session recovery semantics.
- Chat: create; save pairs of user+assistant messages atomically; safe
  idempotent request retries; regenerate/edit last pair; rename, pin,
  archive, delete one/all, feedback create/update and tombstones.
  Explicitly preserve `messages.id INTEGER AUTOINCREMENT`,
  `idempotency_key`, `links_json` and `answer_feedback.message_id`
  for both backfilled and new rows. Current DO `message.saved`
  only accepts stable string IDs and content, so it cannot do this.
- Image chat: optional conversation creation/rollback, timestamp update,
  jobs' conversation association and ON DELETE SET NULL semantics.
  Operator-owned immutable lifetime image-pilot meter cannot be reset.
- Dependent private records: opt-in memory, developer API key metadata,
  GitHub OAuth connection, usage budgets and logs have separate
  retention, credential handling and legal/privacy requirements; these
  are deliberately not copied into the existing chat journal.

The CI gate also **rejects adding any active chat-journal binding/enable flag
to production configuration or journal references to `src/index.js`**
without first making an explicit, separately authorized review/change to
this guard. The closed staging Worker remains independent, not connected to
the BOR AI application; the original production D1 export hard lock remains
in place.

Before a cutover can even be considered: approve storage cost, privacy and
retention; establish an ownership-verified and source-complete backfill;
design a stable integer-ID projection contract across all dependent FKs;
implement journal-first write receipts on **all** active mutation paths
with failure/retry handling; replay every in-flight interleaving, redaction
and post-checkpoint event idempotently; prove read-your-writes behavior;
and demonstrate a successful secure production D1 export to separate
nonproduction recovery **without** jeopardizing the real chat database.
This source inventory **does not authorize** any of those operations.

## 23 Nov 2026 — atomic full-turn event (STAGING SOURCE AND OFFLINE ONLY)

The earlier prototype admitted two independent `message.saved` events for
a user/assistant pair. A crash between their durable acknowledgements
could leave a half-turn, although the real chat D1 saves the pair
atomically with `env.DB.batch`. The new **`turn.saved`** event closes
that **synthetic admission window** by committing the question and answer
as **ONE SQLite Durable Object transaction** and **ONE sequence number**.

The event requires an owner-scoped conversation, distinct stable message
IDs, a unique `request_id`, fixed `created_at`, text and bounded
`links_json` metadata. The private DO validates both IDs and the request
against transactionally persisted admission tables, rejecting reuse even
under a different `event_id`. Retrying the exact original event ID and
canonical body returns the original sequence without adding data.
Invalid URLs, missing values and conflicting payloads fail closed.

The private snapshot collector recognizes `turn.saved` and validates its
redaction, but the legacy toy-schema replay explicitly rejects this new event
rather than silently reconstructing only half a turn. Use the real D1 core
schema replayer for this synthetic proof.

The **offline-only** real-schema replayer now projects that one event into
two `messages` records in **one SQLite transaction** with the replay
checkpoint. It retains the synthetic chat's original timestamp,
`idempotency_key` on the user row, assistant `links_json`, integer
message mapping, and `answer_feedback.message_id` for a follow-up
feedback event. Tests force a crash after both inserts but before the
checkpoint and prove that **both** message rows roll back, while a retry
replays the complete turn only once. Conversation deletion redacts the
entire original turn payload, including links.

**Not accomplished:** The archived production D1 integer primary keys
cannot be known before an autoincrement insert, so this adapter assigns
NEW IDs in an isolated restored SQLite instance, and returns
`originalMessageIdsPreserved:false`. The test is not a real-time
cross-Cloudflare-DO/D1 transaction, and does not supply reliable
acknowledgement/read-your-writes, token/session replay, historical
backfill, lost model-call recovery, image R2 reconstruction, or
ongoing usage cost proof. The currently deployed Cloudflare staging
Worker still runs its last verified image of the DO code; merging this
source does not upgrade that deployed image. **Production app and
production journal remain unchanged/OFF** and no production D1 export
or future deploy is authorized by this source-only PR.

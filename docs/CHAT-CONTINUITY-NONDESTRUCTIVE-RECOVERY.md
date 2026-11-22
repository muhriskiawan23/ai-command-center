# BOR AI — preserving chat across migrations and disaster recovery

**Status 22 November 2026: DESIGN + OFFLINE EVIDENCE ONLY. NOT A LIVE ZERO-LOSS GUARANTEE.** This document authorizes no production restore, database export, Worker deploy, external content transfer, paid services, or schema migration. The current production image D1 migrations remain pending.

## Facts: no automatic merge after Time Travel

Cloudflare D1 Time Travel `restore` **overwrites the target database in place** and cancels in-flight queries. It does **not** preserve later messages or automatically merge their changes. A previous bookmark can undo a restore within the retention window, but this rolls the whole database state back again; it is not a selective merge. Cloudflare's Time Travel fork/clone into a distinct database is not yet available (official docs last updated 20 Nov 2026): https://developers.cloudflare.com/d1/reference/time-travel/.

BOR AI currently stores `users`, `sessions`, `conversations`, `messages`, feedback and related account data **in the same primary D1** `bor-ai-chat`. Messages use an INTEGER AUTOINCREMENT key, while conversations use stable text IDs. Chat writes include additions, edits/replace-last-turn, conversation rename/archive/pin, deletions, account deletion and idempotency keys. A naive `INSERT` of messages from an export **will not** safely reconcile all these operations: replay can collide on auto-generated IDs, resurrect deleted chats, violate ownership, duplicate turns or omit related rows.

## Safest immediate approach for image-only migrations

1. **Do not invoke D1 Time Travel restore on `bor-ai-chat` to undo image changes.** The approved `0012_image_jobs.sql` and `0016_image_chat_history.sql` are additive; their schema introduces image-only tables/triggers/indexes and a nullable image relation, not an intentional rewrite of `users`, `conversations` or `messages`. Use the exact isolated, reviewed migration package only with separately granted owner authorization.
2. If an image feature/migration misbehaves, **disable new image work without replacing the active URL Reader**, preserve private R2/Queue bindings and scheduled image retention cleanup, and inspect the actual D1 schema/migration state. Preserve normal chat writes if proven healthy. Avoid deleting image columns/tables merely to roll back a UI feature.
3. Prefer a **new, forward-only corrective migration** after reviewing live metadata and rehearsing against a synthetic SQLite database. Preserve all new chat rows and sessions; never use destructive `DROP` or global data rewrite without its own independent plan. If SQL repair is unsafe, hold feature changes and escalate instead of silently restoring.
4. Before an approved migration, use an operator-controlled bookmark plus read-only schema/health checks, a measured maintenance window if required, and a post-change smoke including newly created messages. **A bookmark fingerprint is not a backup** and a successful migration plan does not authorize restore or apply.
5. Never run `d1 time-travel restore bor-ai-chat`, `d1 backup restore`, or a script/API equivalent as an automatic migration rollback. This prohibition is operational; outside-application operator access and Cloudflare dashboard actions require separate permissions/control.

**Result:** When the error is limited to additive image schema or feature behavior, the **forward fix avoids rewinding `bor-ai-chat`** and therefore avoids deleting chat writes made after a backup. This is a recovery policy, not protection against an independent catastrophic loss/corruption of primary chat data.

## For true disaster recovery with newer chat preservation

A later, separately reviewed design needs an **independent, durable, private chat event journal** before any claim of recovery point objective (RPO) zero.

Proposed design (not implemented):

- Create an independent storage failure domain, for example a dedicated SQLite-backed Durable Object per tenant/conversation **or** a dedicated chat-journal D1 with careful ordering. This is distinct from `bor-ai-chat`, the image R2 bucket and the temporary image Queue. Do not rely on a Cloudflare Queue alone as a permanent journal; messages can expire.
- Each logical operation gets a stable `event_id`, account/conversation IDs, ordered position, type, version and necessary encrypted/private payload: create message/assistant response, edit or replace turn, rename, archive/pin, deletion **tombstone**, account deletion, and any dependent ownership/feedback changes. Secure access, key rotation, deletion/retention rules, incident response and cost caps must be reviewed.
- **Persist the event in the independent journal before acknowledging durable chat saving to the user.** D1 then becomes an idempotent projection. If the primary write fails after the journal commit, the system retries/reconciles it; do not say the chat was saved in the primary until it can be read consistently. If journal commit fails, fail closed and never claim success. There is no transaction spanning D1 and a second datastore: correct acknowledgement, ordering and retry behavior are essential.
- Before switching the live chat writer to journaling, backfill existing records through a secure, authorized process and verify full coverage. Use a fail-closed cutover, test crash windows between journal and D1 writes, prevent duplicate responses/turns, and account for privacy deletion tombstones so old backups never resurrect deleted content.
- **Emergency recovery sequence:** freeze/suspend new writes with a deliberate gate; determine the last verified journal checkpoint and full required range; reconstruct a consistent recovered database from separately held, authorized data/backups or repair existing data; replay *all* subsequent journal events exactly once, including updates and deletes; verify row ownership, chat counts, content hashes (without logging content), session behavior, monotonic event sequence, replay completeness and privacy deletions; then resume writes. Keep the old database intact until validation and cutover. Since D1 Time Travel does not support clone/fork, do not imply a historical snapshot can be cloned natively.
- If an in-place Time Travel restore is **unavoidable**, it should be a separately approved last resort only after all post-bookmark operations are already preserved independently and replay/read-after-recovery have been validated. Otherwise its potential chat-data loss must be disclosed and it must not be presented as lossless.

Separate D1 databases for chat and image features could further limit the blast radius of future image migrations; the **current** `image_jobs` schema has foreign keys to `users`/`conversations`, so splitting it requires application/schema refactoring and explicit deletion/cascade tests, not simply changing a binding.

## Offline conversation-deletion privacy proof (not deployed)

The synthetic journal prototype in `tools/recovery/chat-journal-prototype.mjs` now overwrites **earlier conversation-scoped payloads in the independent journal within the same write transaction** when `conversation.deleted` or `conversations.deleted_all` is admitted. It erases prompt text, assistant answers, titles, regeneration text and feedback reasons. A minimal `conversation_id` tombstone remains so an offline full replay can verify the subsequent deletion and reject a stale conversation ID without re-creating deleted content. Other users' journal rows are not touched. The same transaction rejects later attempts to write into a deleted or foreign conversation, and refuses reused conversation IDs **before** private message content is admitted. `account.deleted` clears all earlier payload JSON, including retained conversation IDs. The tests do not move data to external providers or create storage resources.

The synthetic recovery code is **not in the production Worker**, has no real authenticated writer, and does not represent GDPR/comprehensive deletion guarantees. Separate retention review must cover journal metadata (`user_id`, event IDs, conversation IDs), replicas, backups, logs, old exports, key management, replay integrity, durable concurrency, pending queues and privacy-erasure proof across the actual primary and independent stores. Historical copies made **before** erasure are not automatically wiped by updating a journal row. No live chat data has been erased or moved in this change.

Evidence: `tests/chat-journal-conversation-erasure.test.js` checks single conversation deletion, delete-all, an independent other owner, fabricated redaction, stale ID re-creation and account deletion on independent in-memory SQLite databases. Passing tests are **offline design proof only**, not a production RPO or privacy certification.

## Production decision gates

- **Now:** image-only schema `plan` is safe read-only; `apply` requires separate owner approval. No production Time Travel restore permitted to "undo" image migrations by default.
- **Before claiming zero-chat-loss recovery:** independent journal deployed, existing history backfilled and verified, write paths and deletes fully journaled, encrypted/retained appropriately, fault-injection and replay tests passed, a second datastore's ongoing costs approved, and a *completed* nonproduction disaster rehearsal documented. Until then, RPO remains **unverified**, not zero.
- Do **not** move real chat exports to CI artifacts, GitHub comments or the image R2 bucket. A full `wrangler d1 export --remote` contains private content and can block other D1 requests: https://developers.cloudflare.com/d1/best-practices/import-export-data/.

## Offline evidence

`tests/d1-chat-forward-recovery.test.js` simulates existing chat → approved isolated image schema additions → new user and assistant chat turns → a benign forward-only corrective schema step on an **in-memory** SQLite DB, and checks all turns, conversations and sessions still exist with the expected contents. This only proves a narrow non-destructive path against the current SQL; it does **not** exercise real D1 restore or guarantee future disaster recovery.

Related documentation: `docs/IMAGE-ONLY-D1-MANUAL-RELEASE.md` and `docs/READER-PRESERVING-MEDIA-RELEASE.md`. Open issues #156 and #351 remain release constraints.

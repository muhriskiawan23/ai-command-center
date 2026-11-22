# BOR AI independent chat journal — OFFLINE proof of concept

**Status: NOT LIVE, no production integration, no real user content.** Code under tools/recovery/chat-journal-prototype.mjs is a local, synchronous Node SQLite experiment. It is not called from src/index.js, not a Durable Object, and not a new Cloudflare resource. It does not change bor-ai-chat or R2/Queue settings. No API key or real chat content is stored by these tests.

## What is implemented

- An independent append-only SQLite recovery_journal with ordered seq and stable unique event_id.
- A second, separate SQLite projection with conversation, message, user, delete-tombstone and checkpoint tables.
- Journal-first event admission with strict payload validation and idempotent event IDs; changed payload with the same ID fails closed.
- Transactional projection of each event and its replay checkpoint. A simulated crash between projection and checkpoint rolls back the partial projection.
- Strict contiguous sequence checks, non-replay of checkpointed events, ownership checks, deletion tombstones and account-delete blocking.
- Replay after synthetic projection loss, including messages created **after** a previous checkpoint.

Run: node --test tests/chat-journal-prototype.test.js. Two **distinct in-memory SQLite databases**, no Cloudflare or external API calls.

## What this does NOT do

1. **No live journal.** The production Worker still writes directly into bor-ai-chat. No production chat mutation is independently captured. No zero-data-loss or RPO=0 claim.
2. **No complete mutation coverage.** The limited vocabulary supports account create/delete, conversation create/rename/delete, and message save. It does not yet cover actual BOR AI's last-turn replacement/regeneration, pin/archive, delete-all, feedback, memory, session or other account mutations.
3. **No privacy-ready retention.** Synthetic message payloads persist in this append-only journal after an account-delete tombstone. A real service must implement data-subject erasure, appropriate encryption/crypto-shredding, journal and backup retention, and privacy tests before recording real users.
4. **No full tamper-proofing.** A gap detector cannot prove completeness if the journal tail or entire journal is lost; separate integrity attestations and monotonic checkpoints must be designed.
5. **No cross-database atomic transaction.** Journal and D1 cannot commit as one transaction. A live solution needs explicit acknowledgment rules, per-account ordering, retries, idempotent replay, read-your-writes consistency, and crash tests.
6. **No deployment, resource provisioning or cost approval.** SQLite-backed Durable Objects support transactional, strongly consistent storage and exist on Workers Free subject to limits. This is a candidate, not a provisioned or approved resource.

References: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ and https://developers.cloudflare.com/durable-objects/platform/pricing/.

## Proposed progression (NOT authorization)

**Phase 1:** keep prototype offline and validate all tests in GitHub CI.

**Phase 2:** design access-controlled per-user or per-conversation Durable Object or independent journal D1 with authorization, versioned events, erasure rules, cost limits and integrity validation.

**Phase 3:** staging-only integration behind a default-OFF flag, then fault injection for journal outage, primary D1 outage, duplicate/reordered events, late writes and deletes. No production enablement.

**Phase 4:** safely backfill existing history under authorization, drill a full nonproduction recovery, compare every acknowledged operation including deletion tombstones, approve a separately reviewed launch.

**Immediate policy for additive image migrations 0012/0016:** prefer forward-only corrections rather than Time Travel restore on the live chat database. See docs/CHAT-CONTINUITY-NONDESTRUCTIVE-RECOVERY.md and Issue #382.

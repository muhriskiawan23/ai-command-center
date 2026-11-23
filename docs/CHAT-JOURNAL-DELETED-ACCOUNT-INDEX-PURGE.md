# BOR AI — Durable Object account-deletion metadata minimization

Date: 23 Nov 2026. Source-only hardening of the **inactive**
\`src/chat-journal-do.js\` journal; no production Worker wiring, D1 schema,
Cloudflare resources, scheduled workflows or paid provider calls.

## Behavior

Deleting an account already removed journal content but left historical chat
IDs and request/message indexes in Durable Object storage. The account-deletion
append now uses **one SQLite transaction** to:
1. Redact every earlier event body, clear its \`conversation_id\`, and replace its
   caller-supplied event ID with an opaque random hex value without changing
   the ordered sequence or deletion tombstone.
2. Purge \`journal_message_ids\`, \`journal_turn_requests\` and
   \`conversation_tombstones\`: no chat can be recreated in a deleted account,
   and the final \`account.deleted\` event still deduplicates the same ACK retry.
3. Set the irrevocable \`journal_owner.deleted=1\` flag.

Source content and those auxiliary identifiers are removed together or none
are removed on a simulated SQLite failure. Redacted records remain
sequential and replay produces only the account-deletion tombstone.

**Important boundary:** The journal still retains the \`user_id\` in
\`journal_owner\` and historical \`journal_events\`, plus the final deletion
event ID and timestamps/sequence metadata. This is **not proof of full GDPR
erasure** or deployed-production account deletion; deletion/retention policy and
independent audit are still required. \`event_id\` randomization is a one-way
data minimization step, not cryptographic evidence of immutability. Old or
undeployed staging data is not migrated by this PR.

P0 issue #382 remains open: all production chat mutation paths, backfill,
hosted Cloudflare restore, RPO and owner-approved production cutover are not
covered by this source-only improvement.

# BOR AI — Full-schema post-snapshot synthetic recovery gate

23 November 2026 — **offline evidence, not a production recovery capability**.
This PR adds a source-only GitHub Actions test running against every one of the
13 checked-in D1 migrations using Node's native SQLite backup/restore API.

## Coverage

- Take a snapshot while two synthetic accounts, conversations, messages,
  sessions, answer feedback, source links, image wallet, ledger, and image
  associations exist.
- Commit five **fake, post-snapshot journal events** independently: atomic
  user+assistant pair with original integer IDs, feedback, metadata update,
  deletion of an archived chat, and another account's deletion.
- Force a failure after the **first** new message insert; neither message nor
  checkpoint is allowed to persist. Resume with the entire journal and verify
  exact source/restore hash parity for every checked-in table, index, trigger,
  and SQLite sequence (including non-chat data).
- Verify deleted content is not resurrected, account/conversation tombstones
  exist, foreign keys remain valid, existing image charges and credits don't
  double, old integer message IDs and sessions survive, and a second replay
  inserts nothing.
- Negative tests: externally pinned minimum head prevents missing tail,
  accidental journal payload corruption, cross-owner deletion, partial replay
  misreported as completion, and reuse of deleted account identity.

This is an **illustrative synthetic tail/projector**, not the real deployed
journal-first writer or production backfill. Its SHA-256 field detects
accidental modification only; it does not authenticate malicious data.
No remote D1 export, Cloudflare-hosted staging restore, user login continuity,
multi-user production replay service or RPO=0 is proven. The production
journal write-surface gate still reports 0/58 literals actively protected.

No Cloudflare API calls or new resource/paid provider access, and no production
schema, application Worker or rollout flag changes. The full-schema test runs
under the existing npm test/PR CI. Leave issue #382 open for independently
approved hosted staging and real production recovery design.

# Owner-only OpenAI Web Search V2 production pilot — 26 November 2026

Production v688 already contained the reviewed candidate, with its exact recorded Worker SHA-256 and migrations 0017/0018 recorded. Owner installed a dedicated production Web Search key, resulting in v689 (f7c04e83-19a8-4854-9ec0-eb59d9410c86). Compared v688 and v689: identical module and runtime metadata; only the new secret binding was added. No staging key copied.

Owner confirmed the BOR AI login account; one matching users row in production D1 was resolved without exporting its internal ID. Captured current recovery bookmark; no migration or D1 write was issued in this session. Global Web Search V2 ledger was empty before activation.

Uploaded v690 (733c22af-cb54-4c54-8e42-ef2470eb9b85), reusing the v689 asset set with keep_assets and inheriting all unaffected bindings. Module and runtime metadata match exactly, existing asset binding retained, all unaffected bindings matched, owner-only allowlist verified, 44 bindings total. At 100% traffic on deployment e004cdd8-bac0-47b3-b4af-322d11c31cd9. Mode v2, kill switch false, GPT-6 Luna, per-user and global daily call limit 1, daily/monthly admission budget 260000 micro USD, reservation 260000 micro USD, Google eligibility false. Nonpilot accounts retain legacy Tavily as designed. No new URL Reader or Google activation. Production key authentication/model access and exact billing have not been verified yet. No provider call initiated by this session.

Next: owner signs into the normal BOR AI UI and submits one synthetic factual search. Verify citations, D1 receipt/counter and provider spend using authorized tools; do not retry automatically. If failure or regression, restore v689 to 100% traffic (legacy mode with dedicated secret retained). Preserve ledger. Stop pilot after review; do not expand to other users or increase budget without approval. The reservation is an application admission ceiling, not a provider invoice guarantee.

This is activation evidence, not evidence of successful production live inference or end-to-end authenticated browser testing.

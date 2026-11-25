# BOR AI Web Search V2 — isolated staging build and campaign guard

26 November 2026 WIB. Source commit: `f2da89746ad7fae7525f691c9cfed4725657ca61`.

## Completed

- Exact source module graph resolved, checked against Git tree and re-hashed using Git blob SHA-1. Version 27 accepted 39 modules from `3d93914`; version 28 accepted 40 modules from `f2da897` (458,500 UTF-8 bytes). Cloudflare version 28 is deployed at 100% staging traffic. This is a direct ES module upload, not a Wrangler bundle or full browser integration test. No CI workflow was dispatched. Temporary unreferenced Git blobs held only repository source to assemble the module graph; no secret values were extracted.
- Active staging version: `a98dea72-e057-4b67-b7cb-c7d112c8e575`; deployment `bfc0a8be-b6ce-4e3f-8652-422c5392bdb9`. Rollback target version 27 `dd0203d7-5454-4f2c-bd36-1a237ec22601`. The existing isolated D1, existing operator secret, and existing dedicated OpenAI key were retained. Explicit organization/project routing is inherited from the earlier successful staging evaluation. All search and evaluation flags remain off; no cron.
- Fixed an admission problem: the previous smoke route's USD 0.26 monthly ceiling and daily call count of one could deny a new smoke after the existing campaign's USD 0.228420 search ledger. The staging-only guard now requires an explicit base evaluation and an expiry of no more than 15 minutes. It atomically creates one durable marker, counts the greater of measured prior campaign spend and all search-ledger reservations, accounts for router overhead, and refuses additional attempts even after failure or month rollover. The same dedicated key is used; no new API key or scope. A reservation is not an absolute provider billing limit.
- New checks: **7/7 native Node SQLite tests** and **5/5 staging integration simulations** passed. The helper and test file SHA-256 hashes were matched to the local files that passed. Previous 17 synthetic checks and 6 historical live scenarios were not rerun. Full Node suite, browser E2E and actual candidate HTTP runtime are not claimed to pass.

## Budget and safety

Read-only D1 inspection: 9 historical search requests, USD 0.228420 search ledger, USD 0.228947 cumulative observed evaluation cost including router. No running evaluation or smoke marker. New provider spend USD 0.00; remaining approved budget USD 0.271053. A proposed one-shot smoke reserves USD 0.26, leaving USD 0.011053 of conservative headroom. Do not enable it until prior spend is reconciled and an authorized operator/runtime path is available. No additional spending automatically approved; provider billing may differ from estimates.

Production version `c6dcf354-46c3-4772-9521-55f97cb2fb78` remains at 100%, same deployment; Tavily unchanged. No new credentials, permission expansion, deposits or GitHub Actions. No production migration or deployment.

## Remaining release blockers

1. Candidate HTTP runtime was not accessible: local curl DNS resolution failed and public web fetch was unavailable. Cloudflare billing read returned HTTP 403; Browser Run was not invoked to avoid unverified costs. Verify the already-deployed candidate without replaying the six prior cases. A native bundle/browser E2E pass is still needed for full application release, including the real chat router versus the isolated evaluation adapter.
2. For a later single smoke, use existing staging operator credentials and the existing key. Set the explicit prior completed evaluation ID `web-v2-responses-20261126-f` and a short expiry only for a bounded authorized test; maintain the persistent budget marker. Keep all live-evaluation triggers absent. Disable smoke and restore kill switch immediately afterward. Do not reset the campaign marker to retry without explicit budget review. Capture request status, actual usage and citation evidence, reconcile provider billing, and stop on any uncertainty.
3. Google Grounding: no existing Gemini key or approved eligibility binding in staging; do not create a key, upgrade billing, or enable it automatically.
4. URL Reader: existing tunnel `bor-ai-private-egress` is down with zero connections; the staging egress binding/token are absent. Restore the existing owner-controlled Termux service and use the existing matching secret securely. Do not weaken SSRF protection or remove Tavily Extract prematurely.
5. Release is still blocked on live candidate verification, actual billing reconciliation, and remaining Google/egress validation. Production and Tavily cutover need explicit owner approval.

Machine-readable evidence: [web-search-v2-staging-build-20261126.json](evidence/web-search-v2-staging-build-20261126.json).

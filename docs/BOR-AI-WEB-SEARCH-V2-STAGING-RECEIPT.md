# Web Search V2 — usage receipt and final safe staging checkpoint

Source: 328afe7b74c1fd66fac8b6e38aa485f02627695b. Staging version 29 active at 100%; rollback v28. All 41 source modules verified against Git blob hashes and accepted by Cloudflare via direct ES module upload, not Wrangler bundle. Production and Tavily unchanged.

Five new receipt tests and four integration simulations passed. Smoke persists only validated model ID, provider request ID, token counts, tool-call count and citation presence. Missing usage cannot produce a passing smoke. The reservation is never released on failure or success until separate reconciliation; no raw provider response or key is stored. This is not proof of actual provider charges.

Read-only staging D1: prior cumulative observed USD 0.228947; search ledger USD 0.228420, 9 historical calls; no new smoke marker or running evaluation. Remaining USD 0.271053; one USD 0.26 reservation would bring conservative committed spend to USD 0.488947. Not an absolute provider billing cap. No new external AI requests, keys, permission expansion, deposits, production changes or Actions dispatch.

## Blocked gates

- Real HTTP access from this chat is unavailable (DNS failure). Keep staging kill switch on, smoke flags off, no temporary triggers. A subsequent authorized operator must use the existing operator secret and existing dedicated key. Do not replay the six earlier successful cases or reset the one-shot marker. Use the verified prior base ID and bounded expiry documented in the staging build report. Reconcile actual usage and billing before deciding release.
- Google Grounding has no bound credential. Existing private egress tunnel is down with no active connection; matching existing token/binding is required. Do not create API keys, change billing or weaken URL safety.
- Native Wrangler build, actual candidate HTTP and full app browser E2E remain outstanding. Release is not yet approved.

Evidence: [JSON](evidence/web-search-v2-staging-receipt-20261126.json).

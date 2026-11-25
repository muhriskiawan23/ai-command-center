# BOR AI Web Search V2 — staging v31

26 November 2026 WIB. Source commit `96781b665a5bc49637f83ffdaefe708ce91465cb`.

Cloudflare deployment `fbc6a8fa-3b39-443f-aceb-458666b9672f` sends 100% of `bor-ai-luna-staging` traffic to version 31 (`6107421e-6721-425c-8f4b-8555330ec3d3`). The upload used direct ES modules. All 41 uploaded modules matched their Git blob hashes. The runtime settings and 11 bindings matched version 30. The production deployment and Tavily were untouched.

## Verification

| Check | Result |
| --- | --- |
| Staging build | Wrangler 4.160.0 dry run passed. |
| Integration | 24 passed, 0 failed, 0 skipped. Actual router, adapter and staging paths with mocked provider responses. |
| Browser E2E | 6 passed, 0 failed, 0 skipped. Chromium at 360×800 and 1280×800. Verified search activity, clickable citations, eligible Google failover and rejection of unsafe Google suggestions using mocks. |
| Expiry patch | Four previously passed focused regressions reused. |
| Hosted staging | GET evaluation and bridge routes returned HTTP 404. POST to the operator route with authorization omitted returned HTTP 401. |
| Live OpenAI | The six historical GPT-6 Luna results were retained. No billable smoke executed on v31. |

Browser logs included failed CDN requests for the unrelated PDF and OCR libraries. The search assertions completed. The run did not cover attachment handling or hosted authenticated chat.

## Security and budget

The hosted checks confirmed fail-closed behavior with the kill switch enabled, search mode off, both smoke flags disabled and no temporary triggers or cron. Read-only D1 inspection found nine historical search calls, no one-shot smoke marker, and no running evaluation. Preserved historical search ledger: US$0.228420. Historical campaign estimate based on provider usage, including router: US$0.228947. Additional OpenAI requests and spend: zero. Remaining against the approved US$0.50 cap: US$0.271053. Provider billing reconciliation is pending.

The supported live route is `POST /smoke/web-search`, authenticated with the existing operator bearer token from the operator's secure environment. The staging Worker has the bound secret but the approved runner for this session did not have access to its value. Keep staging disabled until an authorized operator runtime is available and billing is reconciled. For a single approved invocation, use base evaluation `web-v2-responses-20261126-f`, the documented bounded expiry, the existing key and the persistent one-shot admission marker. The route reserves US$0.26, bringing estimated spend plus reservation to US$0.488947 and leaving US$0.011053 headroom. This is an admission reservation rather than a billing guarantee. Capture the D1 usage receipt, verify citations and reconcile the project charge. Restore safe flags immediately afterward and on failure. Never reset the marker to retry.

## Release gates

- OpenAI: authorized one-shot smoke on v31 and reconciliation. Current evidence supports staging validation with mocks and hosted access-control checks. Production release remains pending.
- Google Grounding: live credential and eligibility binding are absent in staging. Mock failover passed.
- URL Reader: the existing private egress tunnel needs a healthy connection and the matching staging binding and secret.
- Rollback if needed: set staging traffic back to 100% version 30 (`fc76fb0d-ccfb-4000-9799-eda3a781de78`), keep the kill switch enabled, and retain D1 evidence and any reservation. No database changes were applied in this deployment.

[Machine-readable deployment and test evidence](evidence/web-search-v2-staging-v31-20261126.json) · [Historical six-scenario live evidence](BOR-AI-WEB-SEARCH-V2-RESPONSES-LIVE.md)

# BOR AI — OpenAI Web Search V2 production release candidate

26 November 2026 WIB. Continued from feature checkpoint `67474aded9fade1c84cdc0456906b90208b8c533`.

## Candidate and evidence

Use `release/openai-web-search-v2-luna` as the scoped production candidate. It is layered on the exact deployed code annotation `663787a9687f3a2fd56662cc4346a2e88e35129a`; it does not include the feature branch's 187-commit production drift. It preserves the existing chat app, Tavily search and Tavily extraction settings and leaves the new private URL Reader and Google Grounding disabled. Source and build only. No production Worker upload, activation, schema write, secret change, or new provider request was performed.

| Verification | Result |
| --- | --- |
| Candidate Wrangler 4.160.0 dry run | PASS, 370.34 KiB / 103.92 KiB gzip. Worker SHA-256 `4072f503e0cb1360076b6aa2fdf25e1451d5cb192b666002641d4e94deb8b7e7`. |
| Candidate Node + SQLite | **4/4 passed**. Account concurrency, global caps, UTC rollover, empty/missing quota controls, app route, legacy Tavily extraction and kill switch. |
| Candidate browser | **2/2 passed** with mock providers on desktop and phone. Signed-in pilot streamed clickable citations and a second search could not reach the provider. Initial harness setup required FFmpeg before either check ran. Unrelated OCR/PDF CDN requests were unavailable. |
| Feature branch Node and recovery | **15/15 passed** for new pilot and affected schema recovery checks. |
| Migration rehearsal | Replayed the 11 recorded production migrations plus only `0017` and `0018` in isolated SQLite. Existing schema objects were identical and integrity check passed. |
| Provider | Reused historical GPT-6 Luna Responses API smoke and receipt. No new OpenAI or Google request. Production project access and the full production run remain unverified. |

## Release configuration

Live as observed: Worker `ai-command-center`, deployment `2fe985c2-356d-457c-b829-268cfb38df4c`, version `c6dcf354-46c3-4772-9521-55f97cb2fb78`, 100% traffic, 33 bindings. The active version has Tavily configured for search and extraction, including `URL_READER_ENABLED=true`, `URL_READER_PROVIDER=tavily` and extraction quota 8. Preserve these values and all other existing settings and bindings. Do not copy staging credentials, change image/billing settings, add private egress bindings or delete Tavily. Compare the latest upload and active version before using inheritance. The checked-in Wrangler defaults are not a backup of live bindings.

The first approved code deployment stays in legacy mode, with an empty pilot allowlist and Google eligibility false. A separate approval for the OpenAI pilot should set the following overlay on the verified baseline:

| Variable | Proposed initial pilot setting |
| --- | --- |
| `BOR_WEB_SEARCH_MODE` | `v2` |
| `BOR_WEB_SEARCH_KILL_SWITCH` | `false` |
| `BOR_WEB_SEARCH_OPENAI_MODEL` | `gpt-6-luna` |
| `BOR_WEB_SEARCH_PILOT_USER_IDS` | Explicit server-verified account IDs approved for the pilot |
| `BOR_WEB_SEARCH_USER_DAILY_CALLS` | `1` |
| `BOR_WEB_SEARCH_DAILY_CALLS` | `1` |
| `BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD` | `260000` |
| `BOR_WEB_SEARCH_DAILY_MICRO_USD` / `BOR_WEB_SEARCH_MONTHLY_MICRO_USD` | `260000` each, so this proposal admits one attempt per month |
| `BOR_WEB_SEARCH_GOOGLE_ELIGIBILITY_APPROVED` | `false` |
| `BOR_WEB_SEARCH_OPENAI_KEY`, `BOR_WEB_SEARCH_OPENAI_ORG`, `BOR_WEB_SEARCH_OPENAI_PROJECT` | Existing owner-approved production credential and matching routing identifiers, installed through the authorized secret workflow. The dedicated key is absent on the active Worker. |

Every admitted provider attempt reserves its full configured cost before sending. Per-account and shared UTC day/month checks happen in the same atomic D1 write and trigger. Failed or ambiguous attempts retain their reservation. The quota uses day-scoped hashes of signed-in account IDs and stores neither search text nor URLs. Nonpilot accounts retain legacy search. The classifier stays on the existing Workers AI binding without OpenAI text fallback. The search request uses `store: false`, max output of 2,000 tokens, max two requested tool calls, bounded timeouts and response parsing. Only validated HTTPS citations are published. Shared reservations are an application admission ceiling. Actual OpenAI charges still require reconciliation and the provider budget alert is soft.

## Approval, activation and rollback

1. Confirm the active Worker version and recorded D1 migrations again. Capture the exact current deployment/binding inventory and a D1 recovery bookmark before any approved write. Production currently records only `0001` through `0011` and has neither search ledger. Prepare an isolated Wrangler migration directory with only `0017_web_search_v2_usage.sql` and `0018_web_search_v2_user_usage.sql`. Use the existing production D1 binding and matching migration ledger. Verify that the migration list contains exactly those two pending files before an approved apply. A blanket migration command would include unrelated files.
2. With release approval, upload the candidate as a Worker version with live bindings/assets preserved and the legacy overlay. Review version/asset/binding and schema metadata, then promote. Verify login/session, chat/history, existing Tavily and app asset compatibility. Keep pilot closed during the first rollout. Capture the new stable code version ID.
3. With pilot and budget approval, bind the dedicated existing production OpenAI credential if eligible and apply the pilot overlay. Attempt at most one synthetic, non-sensitive search, verify citation, quota, upstream response and cost, and monitor failures and latency before expanding. Stop on missing receipt, upstream billing/auth errors, unexpected spend, citation errors or baseline regressions.
4. Emergency stop: deploy a version with `BOR_WEB_SEARCH_KILL_SWITCH=true` to stop new automatic searches across the candidate, or revert to the verified legacy-only candidate to restore Tavily automatic search. Existing explicit Tavily extraction remains separate. For a full rollback, restore `c6dcf354-46c3-4772-9521-55f97cb2fb78` to 100% if still the verified pre-change version. Confirm live traffic, bindings, assets and chat health. Leave the additive D1 tables and reservations in place. Use point-in-time database recovery only for an independently confirmed data incident, with separate approval. Avoid forced rollback if secret/version checks fail.

**Status: source/build candidate ready for review. Production activation remains gated on owner approval, scoped D1 migrations, eligible production credentials and a bounded post-deploy verification.**

[Prior live Luna evidence](BOR-AI-WEB-SEARCH-V2-OPERATOR-SMOKE.md) · [Cloudflare rollback procedure](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) · [OpenAI project controls](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)

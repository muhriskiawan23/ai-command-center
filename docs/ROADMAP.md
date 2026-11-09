# BOR AI — Hybrid Intelligence Roadmap

**Direction:** Hybrid + All Capabilities  
**Repository:** `muhriskiawan23/ai-command-center`  
**Code baseline:** PR #157 merged as `61ec5a40214e16484cb795ed6f56cc9843668be6`; includes PR #147–#152 provider redirect safety, whitespace-only secret readiness, evidence reconciliation, DNS-rebinding boundary clarification, untrusted-content prompt hardening, exact-commit release pinning and live prompt-injection smoke; PR #153–#154 add exact-release and production traffic/VPC-binding audits; PR #157 adds bounded transient-only search retries and refreshes live Tavily/prompt-injection evidence. PR #155 reconciled the PR #154 audit evidence.  
**Last repository audit:** 2026-11-09  
**Release rule:** No pull request is merged and no production deployment is initiated without explicit founder approval.

This roadmap replaces the earlier phase ordering, which no longer reflects the current repository. It is an execution plan, not a claim that planned capabilities already exist.

## 1. Product strategy

BOR AI will pursue two goals in parallel:

1. **Broad capability parity:** build a reliable assistant that can research the web, reason, work with files, understand multimodal inputs, write and analyze code, use tools, and integrate with user-authorized services.
2. **Distinctive strengths:** deliver excellent research provenance, transparent tool execution, Indonesian/local-market usefulness, configurable model/provider choice, and specialist workflows such as financial and business analysis.

The objective is not to claim that BOR AI is already better than ChatGPT, Claude, or Gemini. Every competitive claim must be supported by repeatable evaluations against named tasks and comparable models.

## 2. Current repository baseline

### Implemented in main (code and tests exist)

| Area | Current implementation | Boundary / verification still needed |
|---|---|---|
| Chat and orchestration | Cloudflare Worker chat API; Coordinator plus specialist modes; Researcher → Analyst → Fact Checker → Writer flow; adaptive model gateway routes task profiles through the shared `runAgent()` path | Gateway is integrated across web chat, Public API and Telegram. Only the existing Workers AI model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is currently eligible; no second provider is active. Real-model quality still needs evaluation. |
| Accounts and history | Google sign-in, secure server sessions, private D1 chat history, pagination, pin/archive/delete/export, idempotent retries | Real Google sign-in and account lifecycle need production smoke tests. |
| Memory | Explicit, user-controlled memory with enable/disable and deletion | Not online model training; memory behavior on the live model needs evaluation. |
| Language and UI | Automatic device language, 10 interface languages, Arabic RTL, localized response handling | Translation quality and layout need human review on real devices and browsers. |
| Web research | Provider-neutral search/news contract, Tavily Web/News production default, optional Brave adapter, curated BOR AI knowledge, source IDs, freshness/trust rules, citation validation, one bounded retry for transient upstream failures | PR #157 release live smoke (run `42603128329`) passed: Tavily Web 1 usable source, News 2 usable sources, plus one controlled live prompt-injection check. `BRAVE_SEARCH_API_KEY` remains absent in production; Brave is unavailable and unverified. |
| Source-page reading | User-supplied URL reader with SSRF protections and bounded reading of up to three search-result pages, page-read status and redirect-aware citation validation | PR #128 blocks IPv4 `192.88.99.0/24`, IPv6 `2001::/23`, and IPv6 documentation `3fff::/20`; cancels rejected/unsupported response bodies. PR #130 correctly expands compressed IPv6 before range checks, preserving valid global-unicast URLs. DNS rebinding/egress behavior remains unverified. Live Brave still requires `BRAVE_SEARCH_API_KEY` and provider quota. |
| Documents | PDF conversion, local OCR fallback for scanned PDFs, CSV/XLSX parsing, PPTX slide-text extraction, and bounded local DOCX paragraph extraction (PR #125 merged and production-deployed) | Image understanding, charts/visual extraction, speaker notes, and arbitrary document formats are not implemented. DOCX reads only `word/document.xml`; images, headers/footers, comments, tracked deletions, and embedded objects are not extracted. |
| Integrations | Telegram webhook; embeddable widget and public API keys; GitHub repository/PR read-only capabilities and OAuth foundation | Each external integration needs live credential, permission, revocation and abuse testing. Gmail/Drive, Calendar, Slack, WhatsApp and general browser automation are not complete. |
| Developer/product APIs | Public single-turn chat API, per-site keys, origin allow-list and quotas | No general-purpose safe code execution or autonomous software-building runtime exists. |
| Security and cost controls | Request limits, daily usage accounting, timeouts, session ownership checks, CSP/security headers, input bounds and regression tests | Production observability, spend controls, anti-bot, disaster recovery and full external penetration testing remain incomplete. |
| Deployment | Cloudflare Worker/static assets, D1 migrations, GitHub Actions tests/preview/production release; Cloudflare Workers Builds Git integration is upload-only | GitHub Actions is the authoritative production traffic promoter. Cloudflare dashboard evidence (9 Nov, after PR #126) showed active version `3ff29355-a717-4ddb-8dd3-7019ea8cf256` at 100%, while Build-uploaded versions `0baa4c49` and `52cef062` were Ready but not active. PR #126 run `42551688572` deployed version `3ff29355-a717-4ddb-8dd3-7019ea8cf256`; PR #124 run `42552262484` deployed `a87d158e-3afa-41b5-b014-0366ab9c3b93` and passed deep D1/AI readiness, agents, and Google config; PR #125 run `42552337757` deployed `7585871b-44a1-444b-aa18-07d0aa25f7c6`. PR #130 run `42554505794` deployed `a9b779a8-7669-44d5-bddb-3dcefcb514be`; PR #129 merge production run `42556216716` deployed `3b8b930a-73a0-4c1f-869e-42665d078062`. The PR #129 release verified pinned D1, no migrations pending and none applied, deep health, agents, and Google Sign-In; optional live chat was skipped. PR #133 (`0d0d7d34011137efa3dd8015b5f422bae23de14b`) adds canonical URL deduplication (fragment and common tracking parameters removed), requests up to 10 bounded candidates, retains at most five results, and limits usable results to two per hostname while continuing through candidates for source diversity. Exact-head CI passed 365/365 unit tests, syntax, preview, E2E, and Workers Builds. Post-merge test run `42557190585` passed 365/365 tests. Production run `42557190489` deployed Worker `662aa46a-7bb2-4629-b7bb-d4187bc70257`; pinned D1 `bor-ai-chat` was verified, no migrations were pending or applied, and deep health, agents, and Google Sign-In checks passed. Optional live chat was not run. Cloudflare Build remains upload-only. PR #153 added a read-only Cloudflare API audit after successful production deploys; PR #152 release audit `42594205702` confirmed active version `eb1eed98-d3a7-4493-87ce-84e9763066b2` at 100% of production traffic. The audit verifies the latest deployment's active allocation, not every account-level egress or dashboard policy. |

### Current work and evidence status

- **PR #108 — Evidence provenance consistency:** merged and deployed. Candidate and baseline evidence must each use one consistent model ID, model version, provider, and routing-policy version; unknown model roles are rejected. The evaluation planner now emits the normalized `baseline` / `candidate` roles and preserves candidate profiles separately.
- **PR #110 — Signed evaluation evidence:** merged and deployed. Adds operator-signed Ed25519 evidence envelopes, canonical payload hashing, signer key fingerprints, and offline verification. The 325-test suite, preview build, Workers build, and E2E passed before merge; post-merge tests and deployment also succeeded. The signer attests to the record; this does not establish provider-origin authenticity.
- **PR #112 — Signed-evidence enforcement:** merged and deployed. Unblinding now requires a valid Ed25519 signature from an independently trusted public key and an exact canonical match to the signed raw worksheet before joining the identity key. Raw evidence is signed before reviewer scoring; failed/skipped runs remain in completion gates and are not sent for review. Pre-merge CI passed 332 unit tests plus preview, Workers build, and E2E; post-merge tests and deployment succeeded. The signature remains an operator attestation, not provider-origin proof.
- **PR #113 — Bounded search-provider response reads:** merged and deployed. Brave API response bodies are now read incrementally with a strict 256 KB cap; oversized chunked bodies are cancelled before full buffering. Pre-merge CI passed 333 unit tests, preview build, Workers build, and E2E. Post-merge tests and production deployment succeeded; D1 migrations and optional live chat remained skipped. No provider calls were made.
- **PR #115 — Candidate quality-floor enforcement:** merged and deployed. The audited baseline is explicitly identified; every non-baseline candidate requires an explicit task quality floor and a measured score above that floor. Pre-merge CI passed 333 unit tests, preview build, Workers build, and E2E. Post-merge tests and production deployment succeeded. No candidate model or provider was added or activated.
- **PR #117 — Expanded bilingual benchmark:** merged. Adds four human-reviewed cases (DAR/NPM/WCTO arithmetic and live-source uncertainty, in Indonesian and English), expanding the fixture to 24 cases and the offline manual plan to 360 runs. Pre-merge CI passed 333 unit tests, preview build, Workers build, and E2E. The planner remains offline with zero provider calls.
- **Multimodal readiness:** `docs/MULTIMODAL-READINESS.md` inventories current Cloudflare vision candidates and the preflight/privacy/cost gates. This is documentation only: account entitlement and image payload compatibility are unverified; no image model is enabled and no inference was run.
- **Live model evaluation:** not performed. The bilingual benchmark, offline planning/reporting, blinded reviewer protocol, consensus, decision engine, unblinding, and provenance gates exist, but no real manual-live comparison or independently reviewed live score set has been recorded. No candidate has been selected or activated.
- **Live Brave provider verification:** still blocked. Production deploy run `42594101536` confirmed `BRAVE_SEARCH_API_KEY` absent and `TAVILY_API_KEY` present (names-only audit); no live Brave request was attempted. Add the secret through Cloudflare secret management, confirm an active plan/quota, then run one bounded Web and News smoke. Never place the key in chat, source code, GitHub issues, or browser code.
- **Second model provider:** none is active. Provider selection, budget, data policy, consent, and rollback must be approved before a provider pilot.
- **Security audit refresh:** `docs/AUDIT-BOR-AI.md` includes evidence through PR #157. The PR #157 release passed one controlled live prompt-injection check; this is not a comprehensive red-team. Production traffic audit run `42603128360` confirmed exact release SHA `61ec5a40214e16484cb795ed6f56cc9843668be6`, active Worker version `379f065c-85ca-4ac4-b6dd-78073a4b1fff` at 100% traffic, and no direct VPC Network/Service binding. Account-wide egress policies remain unverified. DNS rebinding remains unresolved: URL validation does not pin the actual fetch connection; a DNS preflight alone cannot pin the subsequent fetch.
- **PR #121 — PDF multipart resource-limit hotfix:** merged as `6aea5f9` and included in the production deployment of main commit `706004a`. The PDF endpoint caps actual streamed multipart bytes before `formData()`; `Content-Length` is only an early-rejection hint. Regression coverage uses a chunked upload without `Content-Length`. CI passed 335/335 unit tests, syntax, preview build, and E2E (564 passed, 12 skipped); Cloudflare preview deployment succeeded. GitHub Actions post-merge production deployment passed endpoint checks; Cloudflare Workers Builds also deployed the same push. No oversized live production upload has been run.
- **PR #120 — Audit and capability documentation refresh:** merged as `706004ae48cc06182cb74fcd0b6c70fff501dc81`. Unit/syntax/preview validation, E2E, and Cloudflare preview build passed. The merge triggered both production deployment controllers; GitHub Actions production run `42522046920` and Cloudflare Workers Builds production version `9b118c1d-28e9-45a0-8264-c5907436503c` succeeded. GitHub Actions reported 335/335 unit tests, pinned D1 verified, no pending migrations, no migration applied, and health/agents/Google config passed; optional live chat skipped.
- **Release documentation sync (PR #127):** this update reconciles the roadmap, official knowledge base, and technical audit with the final P0 closure evidence, PR #124/#125 production deployments, and the current release controller.
- **PR #124 — Deep readiness endpoint:** merged as `ba8a9513e24948eaea7398bdb6c3ac5280399c86` and production-deployed by run `42552262484` (Worker version `a87d158e-3afa-41b5-b014-0366ab9c3b93`). The endpoint verifies a read-only D1 query and Workers AI binding presence without invoking inference; production deep health, agents, and Google config checks passed. This confirms binding presence, not live model inference.
- **PR #125 — Local DOCX ingestion:** merged as `5627cf9d19d626a47dd619916dca5f9234253c6f` and production-deployed by run `42552337757` (Worker version `7585871b-44a1-444b-aa18-07d0aa25f7c6`). Exact-head CI passed 355/355 unit tests, syntax, preview build, E2E, and Cloudflare preview. The reader extracts bounded local Word paragraphs (5 MB file, 30 MB expanded ZIP, 2,000 entries/paragraphs, 10,000-character context), validates and escapes untrusted server context, and does not upload or persist the raw DOCX. Security hardening uses a bounded XML tokenizer, rejects DTD, skips comments/processing instructions/CDATA markup, preserves CDATA inside real text nodes, and enforces actual decompressed-byte limits. No real-world DOCX corpus/device compatibility study has been completed.
- **PR #126 — Single-release deployment fix:** merged as `93aa3b91093ef69cc1fda5ce1f8ea7caf51f4933`; removed routine `wrangler secret put GOOGLE_CLIENT_ID` from the production workflow to avoid an intermediate Worker deployment. Production run `42551688572` passed 335/335 tests, D1 pin verification, no-pending-migration check, and health/agents/Google config checks; Worker version `3ff29355-a717-4ddb-8dd3-7019ea8cf256`.
- **PR #128 — SSRF and response-resource hardening:** merged as `2d22f13aa4a9ffb0638ebc2c025a23ae8343ed2d`; blocks IPv4 `192.88.99.0/24`, IPv6 `2001::/23`, and IPv6 documentation `3fff::/20`, and cancels rejected/unsupported response bodies. Production run `42553445926` deployed Worker `6b060010-580a-424c-b89e-453be2fcbf3a`; 358/358 tests passed, D1 pin verified, no migrations pending/applied, deep health/agents/Google config passed. No live Brave request or model inference.
- **PR #130 — Compressed IPv6 validation correction:** merged as `812d020b701a45394fae2f3a0f7bd0aeaaae8732`; expands compressed IPv6 literals before special-range checks so valid global-unicast URLs remain accepted while blocked ranges stay denied. Production run `42554505794` deployed Worker `a9b779a8-7669-44d5-bddb-3dcefcb514be`; deployment succeeded.
- **PR #129 — Provider-neutral search adapter:** merged as `f9a7e98b4a5264eca32eeeea73c4a3d07ab1c5da`. Brave Search/News remains the only registered provider; normalized results and adapter-owned readiness/provenance are in place, and unknown provider IDs fail closed without network access. Exact-head CI passed 362 unit tests, syntax, preview build, E2E, and Workers Builds. Post-merge run `42556216747` passed 363/363 tests; production run `42556216716` deployed Worker `3b8b930a-73a0-4c1f-869e-42665d078062`, verified pinned D1/no pending migrations/no migrations applied, deep health, agents, and Google Sign-In. Optional live chat was skipped; no live Brave request or model inference was performed.
- **PRs #137–#142 — Tavily provider and safe live diagnostics:** PR #137 adds the bounded official Tavily Search adapter (basic depth, at most 10 candidates, no generated answer/raw content) while preserving Brave compatibility and existing URL/freshness/diversity validation. PR #138 adds read-only secret-name auditing and opt-in bounded live verification. PRs #139–#141 progressively classify failures without exposing response bodies, credentials, or raw exception messages. PR #141's production release audit detected the `TAVILY_API_KEY` secret name, but its one-time live smoke returned `provider_unavailable` on the first web request; the news request did not run. PR #142 carries only allowlisted `httpStatus`, `failureStage`, and `errorName` through failed-source metadata and prints the same safe fields in the one-time smoke log. Exact-head CI passed all three workflows (tests, E2E, preview build); PR #142 was squash-merged as `e7103102dbbae69ddcfe4840178edb9aa905e17e`. This merge triggers the normal production release path; post-merge production completion and a new live smoke outcome must be verified separately. The one-time smoke is bounded to one web and one news search (two Tavily credits and two AI calls) and stops at the first failure. No provider secret value is read or printed.
- **PR #133 — Search result deduplication and source diversity:** merged as `0d0d7d34011137efa3dd8015b5f422bae23de14b`. Canonicalizes validated URLs by removing fragments and common tracking parameters, requests up to 10 bounded candidates, retains at most five results, and limits usable results to two per hostname while continuing to inspect candidates for diversity. Regression tests cover tracking variants, duplicates, per-host limits, and continued candidate selection. Exact-head and post-merge CI passed 365/365 tests plus syntax, preview, E2E, and Workers Builds. Production run `42557190489` deployed Worker `662aa46a-7bb2-4629-b7bb-d4187bc70257`; pinned D1 verified, no migrations pending or applied, deep health, agents, and Google Sign-In passed. Live Brave Search and model inference remain untested.


### Latest release evidence — PR #147–#150 (9 November 2026)

- PR #147 (3e93c057ffd34412cd8e4542fb69e4390b990a3e) fixed Cloudflare Workers redirect handling for Tavily/Brave by using manual redirects and rejecting 3xx without forwarding credentials. Its live Tavily smoke run 42584585509 passed (Web: 1 usable source; News: 4).
- PR #148 (24541b5d1f1400c516ef1b31426f77547cbbe98f) treats whitespace-only provider secrets as unconfigured and preserves safe fallback selection.
- PR #149 (aa3cfa73ca7c99dfab3bd20bae6d39c808e1ee0d) reconciled security/search evidence documentation.
- PR #150 (f22bbd1d5f4ee0ebe0092457a8503ba1075ef710) corrected overbroad Workers private-network comments and explicitly records that DNS resolution/pinning is not implemented. It changes comments/docs, not runtime network behavior.
- PR #150 exact-head CI passed unit/syntax/preview validation, E2E, preview build, and Workers Builds. Production deploy 42590507391 and post-merge tests 42590507411 succeeded. Production Tavily smoke 42590615200 succeeded: Web Search returned 4 usable sources and News Search returned 4 usable sources.
- The same production deployment's names-only secret audit reported BRAVE_SEARCH_API_KEY absent and TAVILY_API_KEY present. Brave is therefore not live-verified and is not available as a production fallback.
- DNS rebinding/egress enforcement, live-model prompt-injection red-team, Cloudflare active-traffic dashboard reinspection, external penetration testing, and operational percentile/alerting work remain open. Do not convert mocked tests or secret-name checks into live capability claims.


### Latest release evidence — PR #151–#153 (9 November 2026)

- PR #151 merged the roadmap, security audit, adaptive gateway document, search documentation, and official knowledge base updates. Its documentation-only production deployment succeeded (run 42592636404); post-merge tests succeeded (run 42592636226).
- PR #153 added a post-deploy Cloudflare API audit. Its production deploy (run 42593128459) was followed by traffic audit (run 42593229231), which confirmed one active Worker version, 9bf1a915-2a15-4a96-b451-9b278de1c301, receiving 100% of traffic.
- PR #152 (7fdcdb17ae3c529c328803f7a670c71a857a4958) hardened the untrusted external-content boundary, added a controlled hostile-page fixture, pinned release smoke to the exact deployed commit, and changed production deploys to check out and annotate the exact triggering SHA.
- PR #152 production deploy (run 42594101536) succeeded and deployed version eb1eed98-d3a7-4493-87ce-84e9763066b2. The deployment annotation was github-sha:7fdcdb17ae3c529c328803f7a670c71a857a4958. Post-merge tests (run 42594101693) succeeded.
- Production traffic audit (run 42594205702) confirmed deployment d0241912-a4ce-49dd-b5bd-76e916a7aa5a, active version eb1eed98-d3a7-4493-87ce-84e9763066b2, at 100%.
- Tavily live smoke (run 42594205654) passed: Web Search returned 4 usable sources and News Search returned 4 usable sources. The same release ran a controlled live prompt-injection test against a hostile page using the summarizer; the page was read and no protected system-prompt markers were returned.
- The production secret-name audit reported TAVILY_API_KEY present and BRAVE_SEARCH_API_KEY absent. Brave remains unconfigured and unverified.
- DNS rebinding/egress enforcement, account-wide Cloudflare egress-policy inspection, broad model-quality evaluation, external penetration testing, and operational percentile/alerting work remain open. PR #154 found no direct VPC Network/Service binding on the active Worker version, but this does not prove the absence of account-level or indirect egress paths. Do not treat one prompt-injection test or a 100% traffic allocation check as a comprehensive security certification.


### Latest release evidence — PR #154–#157 (9 November 2026)

- PR #154 merged as 8a2f4ac2e3443f919066d030cc9eeb7398911d50.
- Production deployment run 42596155154 succeeded; post-merge tests run 42596155264 succeeded.
- Cloudflare traffic audit run 42596251536 confirmed deployment faaf651a-49e6-46b2-bbec-d1ab808e3ca6, active Worker version a5eb2104-62eb-4d4c-a300-a5fe5b5257c9, and 100% traffic allocation.
- The deployment annotation exactly matched github-sha:8a2f4ac2e3443f919066d030cc9eeb7398911d50.
- The active Worker version metadata contained no direct vpc_network or vpc_service binding. Binding values and network identifiers were not logged; metadata was processed in memory.
- PR #157 later changed only the bounded search retry behavior; its exact-release live smoke run `42603128329` passed Tavily Web (1 usable source), News (2 usable sources), and one controlled prompt-injection check.
- PR #157 traffic audit run `42603128360` refreshed the production evidence: deployment `e58cafd7-7c8c-43eb-9061-221b55288158`, active version `379f065c-85ca-4ac4-b6dd-78073a4b1fff` at 100% traffic, exact SHA annotation, and no direct VPC Network/Service binding. This still does not prove account-wide egress restrictions, indirect access through other services, or DNS-rebinding protection. DNS rebinding remains open pending a pinned egress design.

## 3. Execution principles and release gates

1. **Audit before coding.** Check main, open PRs, recent commits, workflows and current tests before starting a milestone.
2. **One focused change per PR.** Avoid duplicate PRs and overlapping branches. Reuse an existing implementation when it is safer and more complete.
3. **Preserve working behavior.** Add regression tests before refactoring a working capability. Do not remove existing user-facing functionality to simplify a new feature.
4. **Security before autonomy.** External content is untrusted. Tool calls are schema-validated and scoped to user grants. Write actions require an explicit user confirmation with a preview.
5. **Fail closed and be transparent.** If a provider is unavailable, a model times out, or a source cannot be read, say so. Never silently replace missing evidence with model guesses.
6. **Cost is a product constraint.** Meter provider calls, model tokens, retries, file processing and tool execution. Enforce per-user and global ceilings.
7. **Test behavior, not just rendering.** Unit, integration, E2E, security, accessibility and live-provider checks are distinct evidence.
8. **No unapproved release.** CI may build previews, but do not merge, deploy, apply production D1 migrations, change Worker secrets, or enable a new provider/model without explicit founder approval.

A milestone is considered ready only when:
- its acceptance criteria are met;
- all required checks pass on the exact latest PR head;
- relevant security and regression tests pass;
- operational prerequisites and costs are documented;
- production-only behavior is clearly separated from mocked test results;
- the PR remains unmerged until founder approval.

## 4. Prioritized roadmap

### Milestone 0 — Release integrity and repository truth

**Priority:** P0 · **Status:** in progress — deployment-controller conflict resolved; exact-release and active-traffic audits refreshed through PR #157; DNS rebinding/egress, account-wide egress policy, broader live-model prompt-injection resistance, external penetration testing and remaining historical findings still need verification

Work:
- Re-audit merged source-page reading and its SSRF/redirect behavior, source-ID integrity, prompt-injection boundaries, page-read status, persistence boundaries and test coverage.
- Reconcile the historic audit with current code and test evidence. Reproduce open findings before labelling them open or fixed.
- **Completed:** verified Cloudflare Workers Builds production Deploy command `npx wrangler versions upload` creates a version without promoting production traffic; confirmed the GitHub Actions release version remained active at 100% in the Cloudflare dashboard. Issue #122 was closed after recording the dashboard evidence. Keep GitHub Actions as the only production traffic promoter and re-check dashboard traffic after material release-controller changes.
- Verify the authoritative production deployment path and document the exact release gate.
- Establish and maintain a single capability matrix that distinguishes implemented, tested with mocks, live-verified, blocked by credentials, and planned.

Acceptance:
- No duplicate or conflicting open PRs for the same feature.
- Every claimed capability has a source file, test, and a clearly stated live-verification status.
- Exactly one production deployment controller is active, with preview behavior and rollback ownership documented.
- Production migration and secret ownership are documented; no unreviewed migration or provider activation occurs.

### Milestone 1 — Reliable Web Intelligence

**Priority:** P0 · **Status:** provider-neutral search/news adapters, safe diagnostics and bounded transient-only retries are merged and deployed. The exact PR #157 production release passed live Tavily Web/News smoke (run `42603128329`: Web 1 usable source; News 2 usable sources) and one controlled prompt-injection check. Brave live verification remains outstanding because its production Worker secret is absent.

Work:
- PR #91 is merged and deployed; keep live Brave verification blocked until a controlled request confirms key validity and provider quota.
- **Latest live verification — PR #157 release:** one bounded Tavily Web and News smoke passed (run `42603128329`); Web returned 1 usable source and News returned 2. The same run passed one controlled live prompt-injection check. The workflow checked only secret-name presence; it did not read or print the secret value. Earlier PR #147 and #152 smoke runs remain historical evidence; the skipped PR #148 smoke is not a pass.
- Provider-neutral interfaces for search and news are implemented in PR #129. The Tavily adapter uses the official Bearer-authenticated Search endpoint, `basic` depth, a maximum of 10 candidates, `include_answer=false`, `include_raw_content=false`, and the existing URL/freshness/deduplication/diversity gates. When `SEARCH_PROVIDER` is unset and `TAVILY_API_KEY` exists, Tavily is selected; otherwise the existing Brave default remains. Brave remains available through explicit provider selection. Basic Tavily search is documented as 1 credit/request; the free plan currently advertises 1,000 monthly credits and no card requirement. This is a code-level cost bound, not a hard account-level spend cap.
- Evaluate a second provider only after checking official API availability, pricing, terms, regional coverage, data retention and credentials. Do not scrape consumer search pages or use undocumented endpoints as a production fallback.
- **Completed in PR #148:** provider readiness ignores whitespace-only secrets and safely selects a configured fallback; regression test covers Tavily whitespace plus a valid Brave key. **Completed in PR #157:** one bounded transient-only retry for Tavily/Brave within the shared timeout, with safe attempt diagnostics. PR #161 adds a bounded per-isolate provider circuit breaker (closed/open/half-open, one recovery probe, transient-failure threshold and cooldown); it is a resilience guard, not a durable cross-isolate quota or spend ceiling. PR #162 adds an opt-in atomic D1-backed daily upstream-attempt ceiling (default 30 attempts/provider/day, configurable with bounded Worker environment values), reserves the maximum retry count before network access, reconciles unused attempts, and records aggregate per-provider request/success/failure/rate-limit metrics without queries, user IDs, IPs, or credentials. `SEARCH_SHARED_BUDGET_ENABLED=true` activates it only after the additive D1 migration is applied; until then, the existing provider behavior remains available. A worker interruption before settlement conservatively leaves the full reservation consumed until the next UTC day. This is a shared request ceiling, not a dollar-denominated or provider-account monthly spend cap. Remaining: operator-facing metrics visibility, explicit fallback policy and retrieval-quality evaluation.
- Add query classification, freshness controls, source diversity, duplicate detection, canonical URL handling and source-quality signals.
- Improve page extraction for common HTML/article layouts; report paywalls, bot challenges, unsupported formats and failed reads accurately.
- Add retrieval evaluation fixtures for Indonesian and English queries, news, finance, technical research and official documentation.

Acceptance:
- Live web and news requests succeed with a real provider key in a controlled environment.
- Provider failures never produce fabricated search results.
- Every cited source maps to a valid result and its exact validated URL.
- The UI distinguishes search snippet, successfully read page and unavailable page.
- Cost, latency, provider, and failure metrics are observable without logging secrets or private message content.

### Milestone 2 — Adaptive Multi-Model Gateway and Intelligence Routing

**Priority:** P0/P1 · **Status:** Gateway foundation and evidence-governance pipeline implemented; one-provider adaptive routing active; live comparative evaluation and multi-provider expansion remain blocked on controlled evidence and founder decisions

**Founder decision:** Adaptive Multi-Model is the default strategy. The existing Workers AI model remains the only eligible production candidate until a second provider, budget and data policy are explicitly approved.

Post-merge audit of `main` confirms that:
- `src/model-gateway.js` contains validated task profiles, model metadata validation, hard eligibility gates and adaptive candidate scoring.
- `runAgent()` routes specialist calls through the gateway; the current Workers AI model is the only eligible candidate.
- Web chat returns actual model trace metadata; Public API returns it in its response; Telegram shares the gateway path and emits internal structured telemetry without exposing model metadata in the chat message.
- The Public API response path was corrected to handle the string returned by `runAgent()` rather than reading a nonexistent `.response` property.
- Existing timeout/cancellation, memory, locale, quota, output validation/retry and persistence paths remain in the execution flow.
- PDF conversion still uses `env.AI.toMarkdown()` separately and is not part of chat model routing.
- No external provider adapter is active. PRs #98–#108 added the model inventory, original 20-case bilingual benchmark, 300-run offline planner, offline reports and cost aggregates, blinded reviewer packet/consensus flow, evidence-gated advancement decision, post-evaluation unblinding, and baseline/candidate provenance consistency. PR #117 expanded the benchmark to 24 cases and the offline plan to 360 runs. These are governance and offline-evaluation capabilities, not live benchmark results.
- PR #108 is deployed; the production deploy verified the pinned D1 database read-only, skipped D1 migrations, skipped optional live chat, and passed endpoint checks.
- PR #110 is merged and deployed with Ed25519 operator attestations. A valid signature proves record integrity and signer possession only; it does not prove provider-origin authenticity.
- PR #112 is merged and deployed: signed evidence is now mandatory before unblinding and model-advancement decisions; failed/skipped runs remain visible rather than being sent to reviewers as missing outputs.

Architecture specification: [Adaptive Multi-Model Gateway](ADAPTIVE-MULTI-MODEL-GATEWAY.md).

Work:
- Define a provider-neutral normalized gateway contract and versioned model catalog; Workers AI is the first adapter.
- Route semantic task profiles (fast chat, deep reasoning, research synthesis, coding, translation, vision, audio and structured extraction) against verified model capabilities.
- Apply hard eligibility first (capability, context, region, data policy, consent, deadline and spend ceiling), then rank by measured quality, reliability, latency and cost.
- Keep Adaptive quality-aware and cost-conscious: use the least expensive/fastest eligible model that meets the task's evaluated quality floor; select stronger models when evidence justifies them.
- Add bounded transient-only retries, eligible fallbacks, circuit breakers, model/version pinning and per-request trace IDs.
- Return the actual provider/model per agent; do not report one global model when a multi-agent workflow can use several.
- Preserve request deadlines, cancellation, quota accounting, memory, localization, idempotency, output validation and persistence.
- Build Indonesian/English task evaluations and measure cost per successful task.
- Add external providers one at a time only after founder approval of provider, budget, disclosure/consent and data-retention policy.

Acceptance:
- The current Workers AI-only path behaves equivalently before any second provider is enabled.
- No model is selected if it fails capability, context, region, consent, deadline or budget requirements.
- Every specialist result identifies the actual provider/model used.
- Fallbacks are transient-only, bounded, and cannot cross privacy boundaries or duplicate external writes.
- Tests cover web chat, public API and Telegram as well as existing quota, memory, locale and cancellation behavior.
- Benchmarks are repeatable, human-reviewed and include Indonesian-language tasks.
- No second/external provider or candidate is activated, and no production data is sent to a new external provider, without explicit approval and user-facing disclosure/consent.

### Milestone 3 — Multimodal Understanding

**Priority:** P1 · **Status:** partial document support; image/audio understanding not implemented

Work:
- Add image input with strict MIME sniffing, byte/pixel limits, metadata stripping where appropriate, safe temporary storage and explicit retention policy.
- Route image tasks only to a verified vision-capable model.
- Use `docs/MULTIMODAL-READINESS.md` as the current paper shortlist; validate exact model-specific payload schemas, account access, license/data terms, and bounded cost before any isolated pilot.
- Add image question-answering, OCR, chart/table interpretation and document-image extraction with clear confidence and source boundaries.
- Evaluate audio transcription and speech input/output as separate capabilities; select providers only after cost, privacy, latency and language quality review.
- Expand PDF/PPTX handling carefully: charts, embedded images, speaker notes, page references and structured tables.
- Keep file processing bounded and temporary by default; do not persist raw uploads unless the user explicitly requests it.

Acceptance:
- Malformed, oversized and adversarial files are rejected safely.
- Tests cover image prompt injection, hidden text, OCR uncertainty, multilingual documents and large files.
- The model reports unreadable or ambiguous content rather than inventing it.
- User-facing UI accurately shows supported formats and processing status.

### Milestone 4 — Coding and Controlled Execution

**Priority:** P1 · **Status:** code generation is available through chat; code execution/build environment is not implemented

Work:
- Add code-aware workflows: repository inspection, patch proposals, tests, static analysis and review summaries.
- Start with read-only repository access and proposed diffs. Do not grant write permissions by default.
- If execution is needed, use an isolated, ephemeral sandbox with no ambient credentials, restricted network egress, CPU/memory/time limits, filesystem isolation and automatic teardown.
- Add language/runtime allow-lists, dependency controls, artifact scanning and reproducible test logs.
- Require explicit confirmation before creating branches, pushing commits, opening PRs, or changing repository settings.
- Treat generated code, package scripts and repository content as untrusted.

Acceptance:
- A malicious test fixture cannot access Worker secrets, host files, internal network resources or another user's workspace.
- Timeouts and quota limits terminate work reliably.
- All proposed changes are reviewable and reversible.
- No code executes inside the production Worker process.

### Milestone 5 — Tool Use and Integrations

**Priority:** P1/P2 · **Status:** partial integrations exist

Work:
- Define a common tool registry with typed input/output schemas, provider identity, permission scope, read/write classification and audit metadata.
- Standardize per-user OAuth grants, encrypted token storage, refresh/revoke lifecycle and least-privilege scopes.
- Add explicit confirmation previews for every external write action.
- Improve existing Telegram, public widget/API and GitHub read-only flows with live smoke tests and abuse controls.
- Add integrations one at a time based on user value and provider approval: Calendar, Drive/Gmail, Slack/Discord/Notion, WhatsApp Business and other services.
- Add browser automation only after the tool registry, prompt-injection defences, sandboxing, confirmation UX and audit trails are proven.

Acceptance:
- Every tool is scoped to the authenticated user and approved permissions.
- Revocation prevents subsequent access.
- Write operations cannot run without an explicit confirmation token tied to the exact preview.
- Tool output is treated as untrusted data and cannot autonomously authorize another write.
- Audit logs show what ran, when, under which connection and with what result.

### Milestone 6 — Knowledge, Memory and Personal Workspaces

**Priority:** P2 · **Status:** explicit memory and curated knowledge exist; scalable retrieval is not implemented

Work:
- Improve the existing explicit memory experience and preserve user control.
- Add private workspace knowledge bases with document ingestion, chunking, metadata, access control, deletion and re-indexing.
- Evaluate D1 full-text search and vector retrieval/Cloudflare Vectorize or another supported vector store; choose based on measured relevance, cost and operational complexity.
- Add hybrid retrieval (keyword + semantic), reranking and citations back to exact documents/pages.
- Keep account/workspace isolation at every retrieval stage.
- Add user-visible source management, export and delete controls.

Acceptance:
- Cross-account retrieval tests prove strict isolation.
- Deleted documents and memory cannot appear in future retrieval.
- Answers distinguish workspace knowledge from live web research and model background knowledge.
- Retrieval quality is evaluated against a fixed question set.

### Milestone 7 — Specialist Intelligence and Differentiation

**Priority:** P2 · **Status:** specialist agent framework exists; domain-grade evaluations are not implemented

Work:
- Develop specialist workflows for finance/investing, business analysis, data analysis, research and software engineering.
- For financial workflows, use explicitly licensed/reliable data sources, timestamp every market quote, distinguish historical from live data, and never imply guaranteed returns.
- Add calculation tools with deterministic numeric results, reproducible assumptions and clear units.
- Build task-specific evaluation sets and red-team cases.
- Make the coordinator choose specialists based on task requirements and available capabilities, not superficial keywords alone.

Acceptance:
- Numeric outputs are reproducible and tested.
- Time-sensitive claims carry source timestamps.
- Specialist outputs disclose assumptions, uncertainty and source limitations.
- Domain claims are benchmarked against expert-reviewed cases.

### Milestone 8 — Production Excellence

**Priority:** continuous · **Status:** partial

Work:
- Close verified security and operational findings from the current audit.
- Add structured, privacy-safe observability: request IDs, latency, provider/model, tool failures, quota events and deployment version.
- Add budget alarms, global spend ceilings, per-user limits, abuse detection and optional anti-bot protection.
- Verify backups, migration rollback/recovery procedures and data-retention/deletion behavior.
- Expand E2E to supported browsers and real mobile devices; add accessibility and screen-reader checks.
- Add load, soak, failure-injection and disaster-recovery tests.
- Establish staged rollout, rollback and incident-response procedures.

Acceptance:
- Service health distinguishes Worker availability, D1 availability, model availability and search-provider availability.
- Alerts detect error-rate, latency, quota and spend anomalies.
- Recovery procedures are tested, not merely documented.
- No release proceeds with failed, queued, cancelled or unverified required checks.

## 5. First execution sequence

The next work should proceed in this order:

1. **Post-merge regression audit:** PRs #128/#130/#129 hardened source fetching, corrected compressed IPv6 handling, and introduced the provider-neutral search adapter; PR #133 adds canonical URL deduplication and hostname diversity. Latest main run `42557190585` passed 365/365 unit tests; production run `42557190489` deployed Worker `662aa46a-7bb2-4629-b7bb-d4187bc70257`, verified pinned D1/no pending migrations/no migrations applied, deep health, agents, and Google Sign-In. Keep mocked CI evidence separate from live-provider evidence; no Brave request or live model inference was performed.
2. **Live search readiness:** exact PR #157 production release is verified by smoke run `42603128329` (Tavily Web 1 usable source; News 2 usable sources; controlled prompt-injection check passed). Brave Search/News remains unverified because `BRAVE_SEARCH_API_KEY` is absent; configure it through Cloudflare secret management, confirm provider plan/quota, then run a bounded Web/News smoke. Never request or expose any key in chat.
3. **Search resilience:** review PR #161 (per-isolate circuit breaker) and dependent PR #162 (shared D1-backed daily attempt ceilings and aggregate counters) in order; verify D1 migration and exact-head CI before any release. Operator-facing metrics, explicit fallback policy and retrieval-quality evaluation remain follow-up work.
4. **Model evaluation readiness:** PRs #98–#108 established the model inventory, original 20-case bilingual fixtures, 300-run offline plan, offline reporting/cost aggregation, blinded reviewer packet and consensus, evidence-gated advancement, post-evaluation unblinding, and baseline/candidate provenance checks; PR #117 expands this to 24 cases and 360 planned runs. PR #110 adds the Ed25519 operator-signed evidence envelope; PR #112 makes that signature mandatory before unblinding and preserves incomplete runs. Both are merged and deployed. Next, prepare a controlled manual-live evaluation only after verifying account access, exact model versions, data handling, independent reviewers, and a bounded inference budget. Offline tools do not authorize provider calls; no candidate may be activated or routed in production without a separate approval.
5. **Model inventory:** official Workers AI candidate inventory is documented in `docs/WORKERS-AI-MODEL-INVENTORY.md`; next verify account access and run bounded bilingual/task benchmarks before adding any candidate to the runtime catalog.
6. **Current audit refresh:** reproduce historic open findings and prioritize high-risk operational gaps.
7. **Multimodal and sandbox prototypes:** run isolated technical spikes only after model/provider capability, privacy and cost are verified.

Parallel feature work should not bypass these dependencies.

## 6. Decisions and external prerequisites

These are blockers requiring an explicit founder decision or provider-side action:

- Cloudflare Worker secret `BRAVE_SEARCH_API_KEY` and confirmation of an active Brave plan/quota.
- Whether to pay for a second search provider and which official provider/API to use.
- Whether external model providers may process user prompts, memory and files; define opt-in and data-retention rules first.
- Budget ceilings for model inference, search, OCR, storage, browser automation and code execution.
- Provider accounts, OAuth registrations and verification for each connector.
- Whether and when to enable Cloudflare observability, anti-bot services and any additional paid infrastructure.

Never paste secrets into chat or commit them to Git. Configure secrets only through the provider's secret-management interface.

## 7. Non-goals and guardrails

- Do not claim BOR AI is superior to major AI platforms without independent benchmark evidence.
- Do not add providers merely to increase the provider count.
- Do not use unofficial scraping as a substitute for a supported search API.
- Do not silently train on user conversations or infer sensitive user profiles.
- Do not let retrieved web pages, files, tool results or generated code override system policy.
- Do not grant broad connector permissions or autonomous write access by default.
- Do not merge, deploy, apply production migrations or change production secrets without explicit founder approval.

## 8. Progress tracking

For each milestone, track:
- status: `not_started`, `in_progress`, `blocked`, `ready_for_review`, or `complete`;
- branch and PR URL;
- exact head commit SHA;
- required check names and conclusions;
- test coverage and known limitations;
- external credentials, approvals and expected costs;
- whether production verification has actually occurred.

A passing mocked test proves code behavior under the test fixture. It does not prove a live provider, real model, production secret, real user account or production deployment is working.

## 9. Tavily live verification and post-PR-#148 release update — 2026-11-09

- PR #147 merged as `3e93c057ffd34412cd8e4542fb69e4390b990a3e`; production deployment run `42584477901` succeeded.
- One-time live Tavily smoke run `42584585509` succeeded against that released main commit. The Worker secret name was present (value was not read or logged). Live Web search returned 1 usable source and live News search returned 4 usable sources.
- PR #148 merged as `24541b5d1f1400c516ef1b31426f77547cbbe98f`; post-merge tests run `42588126753` and production deployment run `42588126655` both succeeded. Production endpoint verification passed. The change trims/validates provider secrets and falls back safely when Tavily is whitespace-only.
- The post-PR-#148 one-time smoke run `42588229148` was **skipped** by the workflow release-marker condition. It is not a failed smoke, but it also is not a live verification of the exact PR #148 release. The prior successful PR #147 smoke remains valid evidence for the Tavily integration immediately before this readiness-only change.
- Brave Search/News has not been live-verified in this evidence set. Do not infer Brave health from adapter tests or Tavily results.
- Remaining Milestone 1 work: configure Brave credentials and confirm provider quota before a bounded live Web/News smoke; add circuit breaking, per-provider hard budgets/metrics, explicit fallback policy and retrieval-quality evaluations. PR #157 has already live-verified Tavily Web/News on its exact production release.
- Remaining Milestone 0 work: DNS rebinding/Worker egress behavior, account-wide egress policy verification, broader live-model prompt-injection red-team, external penetration testing and reproduction of historical audit findings. PR #157 refreshed the exact-release/100%-traffic/VPC-binding audit; it found no direct VPC binding on the active version but does not establish account-wide egress restrictions.


### PR #157 — bounded search retries and fresh production verification

- PR #157 merged as 61ec5a40214e16484cb795ed6f56cc9843668be6. Exact-head CI passed 382/382 unit tests, syntax validation, preview build, E2E Playwright, and Cloudflare Workers Builds.
- Production deploy run 42603003892 succeeded; post-merge tests run 42603003932 succeeded. The pinned production D1 database was verified read-only and had no pending migrations; no migration was applied.
- The deployment's names-only secret audit found TAVILY_API_KEY present and BRAVE_SEARCH_API_KEY absent. Secret values were not read or logged.
- Live smoke run 42603128329 succeeded on the exact PR #157 release: Tavily Web returned 1 usable source; Tavily News returned 2 usable sources. The same run passed one controlled prompt-injection check: the hostile fixture was read and no protected system-prompt markers were returned. This remains one test scenario, not a comprehensive red-team.
- Production traffic audit run 42603128360 confirmed deployment e58cafd7-7c8c-43eb-9061-221b55288158, active Worker version 379f065c-85ca-4ac4-b6dd-78073a4b1fff, 100% traffic, and exact annotation github-sha:61ec5a40214e16484cb795ed6f56cc9843668be6. No direct VPC Network/Service binding was found on that active version.
- PR #157 implements one bounded retry for transient fetch network TypeErrors and HTTP 408/500/502/503/504 within the shared request deadline. It does not retry provider rate limits (429/432/433), auth/permission errors, aborts, or programming errors. Retry attempts are included in safe diagnostics.
- Remaining: circuit breaking, per-provider hard budgets/metrics, retrieval-quality evaluation, live Brave verification, DNS-pinned egress, and account-wide egress policy verification.


## 10. Post-PR-#160–#163 release status — 2026-11-09

- PR #160 merged as `22a7ecf7304c315104d777591dcbe84031f11707`. The production link reader remains fail-closed because the Worker fetch path does not yet pin the vetted DNS address to the actual TCP/TLS connection. This is a deliberate security mitigation, not completion of DNS-pinned egress. Track the design and acceptance criteria in issue #156.
- PR #161 merged as `ecbd1302ce0689b685ac82b218bc793c39dce7ef` and deployed. The provider-specific per-isolate circuit breaker uses bounded transient-failure thresholds and cooldowns; auth/configuration failures do not count as transient provider outages.
- PR #162 merged as `2aa5d62c278fb50d0301bd8b24b7ef835c542627`. Production D1 migration `0011_search_provider_usage.sql` was applied successfully in run `42618732287`. It adds an opt-in, atomic D1-backed daily upstream-attempt budget and aggregate usage accounting.
- PR #163 merged as `8ec5cd090164422fd5066d0f3ff14930456b3c00` and deployed. `SEARCH_SHARED_BUDGET_ENABLED=true` activates the shared budget. Tavily remains the production search provider. Brave is intentionally not configured or activated; no Brave subscription or credential is required for the current setup.
- PR #160 production deployment run `42620423986` succeeded on `22a7ecf7304c315104d777591dcbe84031f11707`. Post-merge tests `42620424091` and production traffic audit `42620544328` succeeded; Cloudflare Workers Builds check also passed. Production endpoint verification succeeded. The exact-release Tavily live smoke was skipped, so it must not be counted as live verification of this release.
- The one-time Tavily live smoke workflow is configured to run after a successful production deploy only when the triggering release commit message contains `[run-tavily-live-smoke]`. A bounded run performs one Web search and one News search and checks the configured Tavily Worker secret by name only. Do not run Brave tests or purchase/enable Brave.
- Current security blocker: issue #156 remains open. Do not claim DNS rebinding is fixed by DNS preflight alone, ordinary `fetch()`, or an unverified TCP socket workaround. Do not add a third-party egress proxy or alter Cloudflare VPC/network configuration until actual peer-IP pinning, TLS SNI/certificate verification, redirect handling, privacy/retention, credentials, and cost have been independently validated.
- Current release evidence is specific to the commit and workflows above. A successful deploy and endpoint check do not prove live Tavily retrieval, comprehensive prompt-injection resistance, or DNS-pinned egress.


### PR #164 — exact-release production and Tavily verification (9 November 2026)

- PR #164 merged as `4931052546665df57924cef1ae1b5998ef9c0033`. Production deploy run `42622340850`, post-merge tests `42622340875`, and production traffic audit `42622463795` all succeeded.
- The exact active Worker version is `040cae1a-0f5e-48f6-b8ba-4dbfd4c69f28`, receiving 100% of production traffic; the Cloudflare deployment annotation matches the release SHA.
- Exact-release Tavily smoke run `42622463910`: secret presence verified, Web search returned 3 usable sources, and News search returned 5 usable sources. Brave remains absent and unused.
- The same smoke workflow correctly reported the live URL-reader prompt-injection test as **NOT RUN** because link reading remains fail-closed pending safe egress. Do not count that step as a security-test pass.
- New first-party candidate under investigation: Workers VPC Network `cf1:network` routes Worker HTTP traffic through Cloudflare Gateway, where existing DNS/HTTP/Network/egress policies apply and logs are available. Workers VPC is currently documented as beta/free, but requires an active Tunnel/Mesh/WAN on-ramp and account-side policy review. The current docs do not clearly enumerate a Workers VPC Traffic Source selector for safely scoping Network policies. This remains research only; no binding or account networking was changed.
- Issue #156 remains open. Next gate is a read-only account configuration audit, followed by an isolated proof of concept for Gateway policy scope, private/reserved destination blocking, DNS rebinding (mixed A/AAAA and CNAME), redirects, TLS hostname verification, and actual egress/peer evidence. Production URL reading must remain fail-closed until all checks pass.

# BOR AI — Hybrid Intelligence Roadmap

**Direction:** Hybrid + All Capabilities  
**Repository:** `muhriskiawan23/ai-command-center`  
**Baseline:** `main` at `cee8b2799f51f868fd75770b9f52e85ace2a8329`  
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
| Web research | Optional Brave Search and News adapter, curated BOR AI knowledge, source IDs, freshness/trust rules, citation validation | Live search requires the Cloudflare Worker secret `BRAVE_SEARCH_API_KEY`; provider quota and live behavior are not proven by stub tests. |
| Source-page reading | User-supplied URL reader with SSRF protections and bounded reading of up to three search-result pages, page-read status and redirect-aware citation validation | PR #91 is merged and deployed. Live Brave search still depends on a valid `BRAVE_SEARCH_API_KEY` and provider quota; this deployment did not prove live Brave availability. |
| Documents | PDF conversion, local OCR fallback for scanned PDFs, CSV/XLSX parsing, PPTX text extraction | Image understanding, charts/visual extraction, speaker notes and arbitrary document formats are not implemented. |
| Integrations | Telegram webhook; embeddable widget and public API keys; GitHub repository/PR read-only capabilities and OAuth foundation | Each external integration needs live credential, permission, revocation and abuse testing. Gmail/Drive, Calendar, Slack, WhatsApp and general browser automation are not complete. |
| Developer/product APIs | Public single-turn chat API, per-site keys, origin allow-list and quotas | No general-purpose safe code execution or autonomous software-building runtime exists. |
| Security and cost controls | Request limits, daily usage accounting, timeouts, session ownership checks, CSP/security headers, input bounds and regression tests | Production observability, spend controls, anti-bot, disaster recovery and full external penetration testing remain incomplete. |
| Deployment | Cloudflare Worker and static assets, D1 migrations, GitHub Actions tests/preview/deploy workflow | PR #117 merge commit `cee8b2799f51f868fd75770b9f52e85ace2a8329` is the latest main baseline and is deployed. Production deploy run `42518807471` and test run `42518807556` completed successfully; D1 migrations and optional live chat were skipped, while production endpoint verification passed. D1 migrations and optional live chat check were skipped, while production endpoint verification passed. |

### Current work and evidence status

- **PR #108 — Evidence provenance consistency:** merged and deployed. Candidate and baseline evidence must each use one consistent model ID, model version, provider, and routing-policy version; unknown model roles are rejected. The evaluation planner now emits the normalized `baseline` / `candidate` roles and preserves candidate profiles separately.
- **PR #110 — Signed evaluation evidence:** merged and deployed. Adds operator-signed Ed25519 evidence envelopes, canonical payload hashing, signer key fingerprints, and offline verification. The 325-test suite, preview build, Workers build, and E2E passed before merge; post-merge tests and deployment also succeeded. The signer attests to the record; this does not establish provider-origin authenticity.
- **PR #112 — Signed-evidence enforcement:** merged and deployed. Unblinding now requires a valid Ed25519 signature from an independently trusted public key and an exact canonical match to the signed raw worksheet before joining the identity key. Raw evidence is signed before reviewer scoring; failed/skipped runs remain in completion gates and are not sent for review. Pre-merge CI passed 332 unit tests plus preview, Workers build, and E2E; post-merge tests and deployment succeeded. The signature remains an operator attestation, not provider-origin proof.
- **PR #113 — Bounded search-provider response reads:** merged and deployed. Brave API response bodies are now read incrementally with a strict 256 KB cap; oversized chunked bodies are cancelled before full buffering. Pre-merge CI passed 333 unit tests, preview build, Workers build, and E2E. Post-merge tests and production deployment succeeded; D1 migrations and optional live chat remained skipped. No provider calls were made.
- **PR #115 — Candidate quality-floor enforcement:** merged and deployed. The audited baseline is explicitly identified; every non-baseline candidate requires an explicit task quality floor and a measured score above that floor. Pre-merge CI passed 333 unit tests, preview build, Workers build, and E2E. Post-merge tests and production deployment succeeded. No candidate model or provider was added or activated.
- **PR #117 — Expanded bilingual benchmark:** merged. Adds four human-reviewed cases (DAR/NPM/WCTO arithmetic and live-source uncertainty, in Indonesian and English), expanding the fixture to 24 cases and the offline manual plan to 360 runs. Pre-merge CI passed 333 unit tests, preview build, Workers build, and E2E. The planner remains offline with zero provider calls.
- **Live model evaluation:** not performed. The bilingual benchmark, offline planning/reporting, blinded reviewer protocol, consensus, decision engine, unblinding, and provenance gates exist, but no real manual-live comparison or independently reviewed live score set has been recorded. No candidate has been selected or activated.
- **Live Brave provider verification:** status remains unverified until a controlled request confirms `BRAVE_SEARCH_API_KEY`, active plan/quota and successful live results. Never place the key in chat, source code, GitHub issues, or browser code.
- **Second model provider:** none is active. Provider selection, budget, data policy, consent, and rollback must be approved before a provider pilot.
- **Historic audit document:** `docs/AUDIT-BOR-AI.md` is dated 2026-10-31. Treat its findings as historical leads, not as a fresh confirmation of current production behavior. Re-test each item before changing its status.

## 3. Execution principles and release gates

1. **Audit before coding.** Check main, open PRs, recent commits, workflows and current tests before starting a milestone.
2. **One focused change per PR.** Avoid duplicate PRs and overlapping branches. Reuse an existing implementation when it is safer and more complete.
3. **Preserve working behavior.** Add regression tests before refactoring a working capability. Do not remove existing user-facing functionality to simplify a new feature.
4. **Security before autonomy.** External content is untrusted. Tool calls are schema-validated and scoped to user grants. Write actions require an explicit user confirmation with a preview.
5. **Fail closed and be transparent.** If a provider is unavailable, a model times out, or a source cannot be read, say so. Never silently replace missing evidence with model guesses.
6. **Cost is a product constraint.** Meter provider calls, model tokens, retries, file processing and tool execution. Enforce per-user and global ceilings.
7. **Test behavior, not just rendering.** Unit, integration, E2E, security, accessibility and live-provider checks are distinct evidence.
8. **No unapproved release.** CI may build previews, but do not merge, deploy, apply production D1 migrations, change Worker secrets, or enable paid providers without explicit founder approval.

A milestone is considered ready only when:
- its acceptance criteria are met;
- all required checks pass on the exact latest PR head;
- relevant security and regression tests pass;
- operational prerequisites and costs are documented;
- production-only behavior is clearly separated from mocked test results;
- the PR remains unmerged until founder approval.

## 4. Prioritized roadmap

### Milestone 0 — Release integrity and repository truth

**Priority:** P0 · **Status:** in progress

Work:
- Re-audit merged source-page reading and its SSRF/redirect behavior, source-ID integrity, prompt-injection boundaries, page-read status, persistence boundaries and test coverage.
- Reconcile the historic audit with current code and test evidence. Reproduce open findings before labelling them open or fixed.
- Verify the authoritative production deployment path and document the exact release gate.
- Establish and maintain a single capability matrix that distinguishes implemented, tested with mocks, live-verified, blocked by credentials, and planned.

Acceptance:
- No duplicate or conflicting open PRs for the same feature.
- Every claimed capability has a source file, test, and a clearly stated live-verification status.
- The release path and production migration/secret ownership are documented.
- No production change is made as part of this milestone.

### Milestone 1 — Reliable Web Intelligence

**Priority:** P0 · **Status:** partially implemented; live provider verification blocked by secret configuration

Work:
- PR #91 is merged and deployed; keep live Brave verification blocked until a controlled request confirms key validity and provider quota.
- Configure and verify Brave Search/News in a controlled environment after the founder supplies the secret through Cloudflare's secret manager.
- Add provider-neutral interfaces for search and news, preserving the current Brave adapter as the first provider.
- Evaluate a second provider only after checking official API availability, pricing, terms, regional coverage, data retention and credentials. Do not scrape consumer search pages or use undocumented endpoints as a production fallback.
- Add deterministic provider selection, bounded retries, timeouts, circuit breaking, per-provider budgets and a safe fallback policy.
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
- No external provider adapter is active. PRs #98–#108 added the model inventory, 24-case bilingual benchmark, 360-run offline planner, offline reports and cost aggregates, blinded reviewer packet/consensus flow, evidence-gated advancement decision, post-evaluation unblinding, and baseline/candidate provenance consistency. These are governance and offline-evaluation capabilities, not live benchmark results.
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
- No paid provider is activated and no production data is sent externally without explicit approval.

### Milestone 3 — Multimodal Understanding

**Priority:** P1 · **Status:** partial document support; image/audio understanding not implemented

Work:
- Add image input with strict MIME sniffing, byte/pixel limits, metadata stripping where appropriate, safe temporary storage and explicit retention policy.
- Route image tasks only to a verified vision-capable model.
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

1. **Post-merge regression audit:** verify the current main behavior in production; PR #113's production deploy and endpoint checks passed. Keep mocked CI evidence separate from live-provider evidence. PR #113 closed the unbounded search-provider response buffering gap. PR #115 added and deployed the explicit quality-floor gate. PR #117 expands the offline benchmark to 24 bilingual cases and 360 planned runs.
2. **Live search readiness:** verify Brave Search/News with an approved Worker secret and active provider quota; never request or expose the key in chat.
3. **Model evaluation readiness:** PRs #98–#108 provide the model inventory, 24-case bilingual fixtures, 360-run offline plan, offline reporting/cost aggregation, blinded reviewer packet and consensus, evidence-gated advancement, post-evaluation unblinding, and baseline/candidate provenance checks. PR #110 adds the Ed25519 operator-signed evidence envelope; PR #112 makes that signature mandatory before unblinding and preserves incomplete runs. Both are merged and deployed. Next, prepare a controlled manual-live evaluation only after verifying account access, exact model versions, data handling, independent reviewers, and a bounded inference budget. Offline tools do not authorize provider calls; no candidate may be activated or routed in production without a separate approval.
4. **Model inventory:** official Workers AI candidate inventory is documented in `docs/WORKERS-AI-MODEL-INVENTORY.md`; next verify account access and run bounded bilingual/task benchmarks before adding any candidate to the runtime catalog.
5. **Current audit refresh:** reproduce historic open findings and prioritize high-risk operational gaps.
6. **Multimodal and sandbox prototypes:** run isolated technical spikes only after model/provider capability, privacy and cost are verified.

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

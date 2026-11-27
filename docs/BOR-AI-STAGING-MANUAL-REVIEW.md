# Review a staged BOR AI answer-quality candidate

## Files

- [Pinned source at af5dd9b](https://github.com/muhriskiawan23/ai-command-center/tree/af5dd9b473576affbcc269b90b28e852d506ca82). GitHub can provide the exact source archive if needed.
- [Review configuration](../evaluation/answer-quality-staging-review.json). Target: `bor-ai-luna-staging` only. Source of inherited bindings: active v35 (`2b99a156-92d6-4ebb-bfa4-02a7cc9efe6a`), with 100% of staging traffic. No raw secret values or database identifiers are included.
- [Benchmark execution preflight](./BOR-AI-BENCHMARK-EXECUTION-PREFLIGHT.md). Shared campaign reservation remains US$0.50. Review alone is free.

## Owner dashboard steps available now

1. Open [bor-ai-luna-staging → Deployments](https://dash.cloudflare.com/1698b70193eb133044e9fb07e39b7740/workers/services/view/bor-ai-luna-staging/production/deployments). Verify that the active staging version is still `2b99a156` at 100%. The dashboard environment label “Production” refers to this staging Worker's environment.
2. Open [Settings → Variables and Secrets](https://dash.cloudflare.com/1698b70193eb133044e9fb07e39b7740/workers/services/view/bor-ai-luna-staging/production/settings) only to identify the existing bindings. The review manifest enumerates all 12 and identifies the four disabled-feature settings to preserve. Do not edit, re-enter, copy, or reveal a secret. Leave the D1 target, routes, compatibility settings, and active traffic as they are.
3. Check whether a release operator using an independently approved environment has already created a staged version tagged with the exact commit. If one appears, share only its Cloudflare version ID. Leave traffic at 100% on v35 until the candidate is validated. Use neither an older Ready version nor the synthetic preview for a live benchmark.

## Preconditions for staging version creation

The [official Worker Versions API](https://developers.cloudflare.com/workers/observability/errors/#inherit-binding-errors-10057) supports explicit source-version inheritance. The proposed operation would create an undeployed version with `deploy=false`, reusing the existing binding names and types from v35 inside the same Worker. Compare D1 resource identity, runtime settings and all bindings inside the authorized environment. Require that the staging kill switch remains true, search mode remains off, version URLs remain disabled, and the active deployment stays at v35. Tags are labels and must be backed by exact code receipts. No migrations, route edits, quota resets or secret changes are required by the review.

The previous upload was rejected by the Work safety review. This checklist is for read-only verification and formal release review. It does not provide instructions to replay the rejected operation via dashboard code edit, Wrangler, a different connector, or alternate credentials. A Cloudflare account owner does not gain approval for that action via the Cloudflare Deployments page.

## Smoke-test wrapper at the core revision

The GitHub blob for `src/luna-staging-worker.js` at `af5dd9b` is `fbcc1c752d04703c6c6a2bec4de4ae2a65caddaf`. The wrapper accepts only two fixed synthetic operator POST routes and calls the app with the fixed prompt `hi bor`. It has a per-day smoke quota. It does not expose the six-case integration benchmark or the shared one-shot US$0.50 reservation. Uploading that entrypoint alone would therefore not unblock live evaluation. Exposing the general app entrypoint or adding secrets to the public mock preview would change the protection boundary.

The local exact-wrapper bundle compiled with esbuild 0.28.2 and passed `node --check`. Its SHA-256 is `780b0693fb1e8d8499ec2476e5969684ac5878e1856943a4ab50da0d84b28510`. It was a compile check, not a deployment artifact or live runner.

## Benchmark runner readiness

- The current review pins `src/luna-answer-quality-benchmark-worker.js` at `d1e5ee9`. The manifest records its full source commit and Git blob. The runner evaluates the unchanged application core at `af5dd9b`. Its six scenarios span seven turns. See the [adapter notes](./BOR-AI-STAGING-BENCHMARK-ADAPTER.md).
- Read-only Cloudflare metadata verified v35 at 100% of staging traffic, all 12 baseline binding names and types, the four safety settings, the runtime settings, and disabled version URLs. Nine existing bindings are consumed directly by the runner. Preserve all 12 baseline bindings in the staging review. Secret values were excluded from inspection output.
- The active v35 has neither `BOR_LUNA_ANSWER_BENCHMARK_ENABLED` nor `BOR_LUNA_ANSWER_BENCHMARK_EXPIRES_AT`. They are listed in the manifest as activation settings for an approved benchmark window. Keep the review dormant with the kill switch on. During an approved operator-only window, the runner requires an explicit enable flag, an expiry at most five minutes away and the staging kill switch off. Ordinary staging Web Search and URL Reader remain disabled. Restore the dormant state when the window closes.
- After approval, verify the candidate and staging D1 identity, then validate the isolated runtime with synthetic responses. Reconcile the shared one-shot campaign ledger before any live benchmark. The US$0.50 ceiling, authenticated browser regression and production release gates still apply.

## Google Search Grounding fallback

OpenAI Web Search with GPT-6 Luna remains the primary route. This review covers Google as a staging-only fallback for eligible pilot accounts.

- Existing evidence records three passing Google integration simulations and four passing browser tests with mocked providers. The old AI Studio playground returned `permission denied` on `gemini-4-hydrogen` without a selected staging key. Staging probes produced no Gemini provider receipt. The active v35 includes the Google secret binding, and access for that credential remains unverified.
- Google documents Grounding for both `gemini-3.5-flash-lite` and `gemini-2.5-flash-lite`. The Developer API pricing table lists no Free Tier Grounding for 3.5 Flash-Lite. Standard 2.5 Flash-Lite lists up to 500 grounded prompts per day shared with 2.5 Flash, subject to project access. Google limits access to 2.5 models to prior active users and plans to route 2.5 Flash to 3.5 Flash-Lite starting December 1, 2026. Use 2.5 Flash-Lite as the only model candidate for the no-cost check once this project's access and free quota are confirmed. [Supported models](https://aistudio.google.com/docs/google-search#supported-models) · [Pricing](https://aistudio.google.com/docs/pricing#gemini-2.5-flash-lite) · [Deprecations](https://aistudio.google.com/docs/deprecations#gemini-2.5-flash-models)
- The Google AI Studio Rate Limit page for BOR AI Staging shows Free Tier. With All models enabled, the Gemini 2.5 Search Grounding quota group includes `gemini-2.5-flash-lite` and shows 0 / 1.5K daily peak usage. The Gemini 3 and newer Search Grounding group shows 0 / 0. The model-specific 2.5 Flash-Lite text request row shows 0 / 20 daily peak usage. These are dashboard values. The published Free Tier Grounding allowance and a successful request with the existing staging key are still required to verify live access.
- Before a live test, verify the existing key's authorization for the selected endpoint and model. Keep the Google fallback disabled until an approved staging runner returns one successful Grounding response for a public synthetic prompt. Use the existing managed key and an approved test account. Check the returned citations and Google Search suggestions, then reconcile Google usage. Leave production on its existing configuration.
- If project eligibility needs clarification from Google, report the project tier, exact playground model and error, and the lack of a staging-key provider receipt. Ask whether the existing project can use 2.5 Flash-Lite Grounding on the Free Tier. Keep this distinct from the OpenAI Auto-review case for staging upload authorization.


## Doha citation browser regression

- Commit `93589653c05b6a7a28d616eb54b11e5a8fefee03` adds one browser regression for the authenticated Jakarta hospitality-agency question and its contextual Doha follow-up. The test verifies conversation context, the derived Doha query, inline citation rendering, the cited source link, popup navigation and the synthetic source page.
- The new test passed on all eight configured projects: four phone portrait viewports, phone landscape, tablet portrait, tablet landscape and desktop. Result: 8 passed in 7.9 seconds. The run used synthetic provider responses and local routed citation fixtures; it made no live provider request and incurred no API cost.
- The first attempt did not execute application code because workspace maintenance had removed the pinned Playwright browser. Repository-locked dependencies and Playwright Chromium build 1194 were restored from the official distribution, then the same new test completed successfully. External PDF/OCR CDN requests were unavailable in the sandbox, but they are unrelated to this chat and citation path and did not affect the passing assertions.

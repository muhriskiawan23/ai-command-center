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

## Concrete blocker found in the pinned source

The GitHub blob for `src/luna-staging-worker.js` at `af5dd9b` is `fbcc1c752d04703c6c6a2bec4de4ae2a65caddaf`. The wrapper accepts only two fixed synthetic operator POST routes and calls the app with the fixed prompt `hi bor`. It has a per-day smoke quota. It does not expose the six-case integration benchmark or the shared one-shot US$0.50 reservation. Uploading that entrypoint alone would therefore not unblock live evaluation. Exposing the general app entrypoint or adding secrets to the public mock preview would change the protection boundary.

The local exact-wrapper bundle compiled with esbuild 0.28.2 and passed `node --check`. Its SHA-256 is `780b0693fb1e8d8499ec2476e5969684ac5878e1856943a4ab50da0d84b28510`. It was a compile check, not a deployment artifact or live runner.

Resume only when an independently approved, operator-restricted staging runner can invoke the exact candidate under a verified shared campaign ledger. Verify the release gates, run the benchmark and authenticated regression, then evaluate production. No production change or paid request was made.

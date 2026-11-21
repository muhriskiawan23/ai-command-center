# BOR AI — bounded Reader-preserving Media Lab release

**Status:** Reviewed code path only. This does not approve production deployment, Tavily provider safety, paid inference, image generation or payment activation. Security issues [#351](https://github.com/muhriskiawan23/ai-command-center/issues/351) and [#156](https://github.com/muhriskiawan23/ai-command-center/issues/156) remain open until independently validated.

## Why this path exists

The authenticated read-only Cloudflare audit run [#44903223130](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44903223130) reports the 100%-active URL Reader as `true`, with a nonzero Tavily Extract quota. `main/wrangler.jsonc` intentionally has Reader `false` and Extract quota `0`. Deploying `main` unchanged would disable the owner's working public-link reader.

This workflow offers **two distinct explicit choices**, never an automatic switch:

- **Preserve**: Select `preserve_active_tavily_reader=true` and keep `allow_reader_shutdown=false`. The workflow fetches the active 100%-traffic Cloudflare Worker version and verifies one exact flag `true`, provider `tavily`, existing Extract quota strictly **1–8 URLs/day**, and one `TAVILY_API_KEY` secret binding (name/type only, never value). It then generates a local-only copy of the reviewed config with those *same* Reader settings and no additional quota. It does not write to Cloudflare during preflight.
- **Disable**: Select `allow_reader_shutdown=true` only if the owner separately approves loss of external link reading. This continues to use the reviewed Reader-OFF baseline. Both choices cannot be selected together.

With neither option selected, the deployment **fails closed** when the live Reader is already on, without uploading any Worker version. If active metadata is missing, ambiguous, unexpected, the provider is not Tavily, a secret is unprovable, or the quota exceeds 8, preservation **fails closed**. No fallback to arbitrary Worker `fetch()`, new proxy, or unsupported third-party provider is permitted.

The GitHub Actions production workflow is **manual dispatch only**, is limited to `main` and has no automated production release on commit.

## Safe, reviewed release inputs

- `preserve_active_tavily_reader=true` (only after provider-side redirect/SSRF/privacy risk acceptance).
- `allow_reader_shutdown=false`
- `apply_db_migrations=false`
- `enable_billing_shadow=false`
- `run_tavily_smoke=false` (no provider Extract or paid search in this release)
- GitHub production environment `BOR_IMAGES_ENABLED=false`, `BOR_TEXT_LUNA_PRIMARY=false`.
- Do **not** configure `OPENAI_API_KEY`, image credits, billing or browser automation as part of this release. Existing secrets are not printed or rotated.
- Confirm primary production D1 `bor-ai-chat` identity and login/session continuity. Candidate must return model-generated chat and Media Lab HTML/assets before promotion; the Reader-preserve path also checks candidate `/api/plugins/capabilities` reports webReading enabled/available, webActions unavailable, without a paid Extract call. Run the same smoke after release.

## Remaining security limitation

A correctly classified existing Tavily binding does **not** prove how Tavily handles HTTP redirects, DNS rebinding, retention or sensitive URLs. The application blocks common private endpoints, credentials and all URL query strings, but provider-side guarantees still require contract/security review. Do not claim general unrestricted browser automation; there are no user-authorized browser actions in this release.

## Rollback

If candidate smoke fails, no production promotion should happen. If a post-promotion smoke fails, stop further changes and use Cloudflare Workers Version rollback to the reviewed previous version (preserving original D1). Verify the exact active version's bindings after any rollback. Do not apply production database migrations or silently disable the Reader to work around a failure.

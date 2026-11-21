# BOR AI — separate, read-only Cloudflare R2 audit credential

**Problem observed:** The production GET-only image readiness audit [run #44912959060](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44912959060) returned `r2BucketProbe=denied`. This means **R2 bucket existence is unknown**, not that the bucket is missing. The existing Cloudflare credential can read Worker/D1 metadata and must remain unchanged to protect deployment and the active Tavily URL Reader.

**Code change:** The `BOR AI image launch readiness audit (read-only)` workflow accepts one optional *GitHub production environment secret*, `CLOUDFLARE_R2_AUDIT_TOKEN`. If present, the audit uses this token **only for Cloudflare REST paths beginning `/r2/`** (bucket metadata and domain privacy GET requests). All Worker, Queue, D1, and public health requests continue to use the existing Cloudflare token. If not present, the prior behavior is preserved. Neither token is printed or persisted.

## Required account-holder setup (only when ready)

1. In the exact Cloudflare account that owns `bor-ai-chat` and the Worker, review API token permissions. Cloudflare's R2 authentication documentation describes the **Workers R2 Storage Read** account-level permission for listing buckets and viewing their configuration. The R2 **Object Read only** token applies to the *S3-compatible API*, not these Cloudflare REST metadata endpoints: https://developers.cloudflare.com/r2/api/tokens/
2. If the owner authorizes a separate, short-lived, account-restricted **read-only** token, store its raw token value directly in GitHub **environment `production` secret** named `CLOUDFLARE_R2_AUDIT_TOKEN`. Never paste it into issues, chat, logs, source code, shell history, or screenshots.
3. Re-run **BOR AI image launch readiness audit (read-only)** from `main`. It will identify whether bucket `bor-ai-images` exists and, if yes, whether public R2.dev and custom domains are disabled. If the token is denied, the report stays `unverifiable` and no resource is created.
4. Remove/revoke the short-lived token when no longer necessary. Do not rotate or replace `CLOUDFLARE_API_TOKEN`, grant write scopes, or broaden Worker deployment access merely to inspect R2.

The workflow does **not** create the R2 bucket, create Queue resources, modify billing, run D1 migrations, deploy Workers, or use OpenAI credits. Production release still requires independent security and cost approval.

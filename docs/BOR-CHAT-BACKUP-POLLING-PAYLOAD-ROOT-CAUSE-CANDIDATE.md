# BOR AI — D1 backup polling payload correction (source-only)

## Evidence from the two failed owner-approved live exports

- First Cloudflare Workflow `bor-ai-private-backup-45090501363-1` errored: `private_backup_export_request_failed`. Cloudflare Workers does not support `redirect: 'error'`; isolated backup Worker was subsequently updated to `redirect: 'manual'` with strict no-follow 3xx.
- Second Cloudflare Workflow `bor-ai-private-backup-45095546441-1` errored: GET-only diagnosis [run #45096945448](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45096945448) classified `private_backup_export_api_unavailable`, i.e. non-2xx response to a D1 export POST. It reported `stepCount=2`, which is consistent with (but does not conclusively prove) having reached the continuation/poll step. The old Worker did not retain exact HTTP status or raw provider errors. No valid production R2 SQL object has been verified.

The owner showed Cloudflare `BOR-AI-Private-D1-Export` token has `D1: Edit`, expiry November 30, 2026. GitHub `production` environment's `BOR_PRIVATE_D1_EXPORT_TOKEN` was last updated around the time of preparation. The token value mapping to the Cloudflare-named token is probable but not cryptographically proved. Do not assume a D1 Read-only token or rotate the credential on speculation.

## Documented request shape vs prior Worker behavior

Cloudflare D1 Export API requires body `output_format: "polling"` for `POST /accounts/{account}/d1/database/{database}/export`. The optional `current_bookmark` field continues a running export:

- First POST: `{"output_format":"polling"}`.
- Continuation POST: `{"output_format":"polling","current_bookmark":"<private bookmark>"}`.

Cloudflare's Wrangler source sends both fields on every continuation POST; previous BOR AI Worker omitted `output_format` when `current_bookmark` was supplied. This **could** cause a non-2xx failure depending on API validation. Note the separate published Cloudflare Workflows illustrative example has omitted the field on continuation, so this is a compatibility-safe fix and a *hypothesis*, not a definitive proof of why the second attempt failed.

The correction in `src/bor-chat-private-backup-core.js` adds the required format to the bookmark continuation POST. Tests assert exact start and continuation bodies and that a strict mock D1 endpoint would reject an omitted format. No redirect, bucket, D1 database ID, secret value, owner gating, retention, or backup scheduling is changed.

References:
- Cloudflare D1 Export API: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/
- Wrangler D1 export implementation: https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/d1/export.ts

## Operational safety

This is source/tests/docs ONLY. It does NOT redeploy the isolated Worker, restart the failed Workflow, or run a third production D1 export. Both owner approvals have been consumed. A future live attempt requires separate informed approval, low-traffic verification and a new root-cause-oriented preflight, with no full-contents SQL downloaded into GitHub.

A successful future export receipt would still need an independent protected nonproduction restore/consistency drill; zero-loss recovery, journal and replay remain tracked in GitHub issue #382.

# Cloudflare D1 backup failed twice — capture safe HTTP status on any future authorized attempt

As of November 23, 2026, **no successful production chat backup has been verified**. Owner approved two separate one-time exports. Both Cloudflare Workflows errored:

- First `bor-ai-private-backup-45090501363-1`, GET-only diagnosis: `private_backup_export_request_failed`; Workers-unsupported `redirect:'error'` was fixed and the isolated Worker redeployed.
- Second `bor-ai-private-backup-45095546441-1`, GET-only diagnosis run [#45096945448](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45096945448): `private_backup_export_api_unavailable`. From the pre-change source, this means the D1 export POST got **non-2xx HTTP**, but the original code deliberately discarded status and response body. Thus it could be `400`, `401`, `403`, `429`, `5xx`, etc. **Do NOT assert token permission is definitely the cause.**

Cloudflare [D1 debug documentation](https://developers.cloudflare.com/d1/observability/debug-d1/) says exporting a database requires a D1 **Write** token. Error 10000 on D1 export commonly indicates the token only has D1 Read. Earlier read-only GET metadata preflight confirms token activity and D1 resource read access but does not establish D1 Write. The export token is installed as `BOR_D1_EXPORT_TOKEN` on the isolated Worker and should never be disclosed or logged. Its value is not available to GitHub log readers and should not be requested in chat.

## Safe future diagnostics (NO new export now)

`src/bor-chat-private-backup-core.js` now exports `classifyExportHttpFailure(status)` which maps non-2xx response codes into fixed categories:
- `400,401,403,404,409,413,422,429` are distinguishable by status only.
- Other 4xx are `private_backup_export_http_4xx`; 5xx become `private_backup_export_http_5xx`.
- No raw Cloudflare response headers, body, signed URLs, SQL or token may appear in thrown errors or output.

This code change alone is inert unless the **isolated backup Worker** is independently redeployed. It does NOT authorize a third export. A third export would need a new explicit informed owner decision, safe low-traffic window, pinned D1, verified private R2 retention, and demonstrated credential scope.

## The next step, WITHOUT another export

Inspect the existing token's *permission group* in the Cloudflare dashboard. Check whether its scope is limited to the intended account and includes `Account / D1 / Write`, not just `Read`. Confirm whether it has expired or IP restrictions. Do not share the token secret or broaden privilege without an independent review. If it lacks D1 Write, use a newly reviewed narrowly scoped token in a separate approval process. No production SQL read, backup trigger or restores should be attempted merely to check token metadata.

Regardless of token correctness, SQL retention/recovery is not proven. A successful metadata receipt still requires independent isolated restore validation, and zero-loss recovery remains blocked by the chat journal/replay gap tracked in #382.

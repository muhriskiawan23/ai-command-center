# Verify one already-triggered private chat backup (read-only)

The owner triggered exactly one real production D1 backup:
[GitHub release run #45090501363](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45090501363).
GitHub only proves Cloudflare accepted Workflow instance `bor-ai-private-backup-45090501363-1`. This is NOT backup completion.

Use manually triggered `.github/workflows/bor-ai-private-backup-instance-audit.yml` on `main`.
Default `phase=plan` runs local mocked tests only.
To check Cloudflare, choose `phase=audit`, provide the current reviewed 40-character main SHA and
`owner_confirmation=AUDIT_ONLY_NO_EXPORT`.

The workflow fetches **only metadata**, with two read-only HTTP GET requests:
1. `GET /accounts/{account_id}/workflows/bor-ai-chat-private-backup-v1/instances/bor-ai-private-backup-45090501363-1?simple=true` (instance status, stripped of per-step output)
2. Only if status `complete` and success true: `GET /accounts/{account_id}/r2/buckets/bor-ai-chat-private-backups/objects?prefix=<exact deterministic expected key>`.

Verifies an exact bucket, date, Workflow instance ID and object key; bounded non-zero SQL dump file size (max 64 MiB); `http_metadata.contentType=application/sql`; metadata source `bor-ai-chat`, format `d1-sql`, and matching Workflow instance.
Prints only status, metadata booleans and file byte count. No object keys, SQL bytes, signed URLs, prompts, chat, tokens or provider step outputs are emitted. A missing token permission or missing object fails closed without replaying the trigger. The metadata listing uses the dedicated GitHub environment `CLOUDFLARE_R2_AUDIT_TOKEN` and `CLOUDFLARE_BACKUP_DEPLOY_TOKEN`; missing object-list permission is a separate operational finding, not evidence of an absent backup.

This audit does NOT prove the private SQL is importable, recover every conversation, provide a post-checkpoint journal or zero-loss RPO, validate user ownership/tombstone behavior, or license restoration of the primary D1 database. Those require a separate nonproduction privacy-sensitive restore review and independent owner approval.

References:
- Cloudflare [Workflow instance GET](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/get/)
- Cloudflare [R2 metadata object LIST](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/)
- Issue #382.

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

## Diagnosing a failed Workflow WITHOUT retriggering D1 export

The owner ran the first metadata receipt check on 23 Nov 2026:
[GitHub run #45091708681](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45091708681).
The GET of the exact Cloudflare instance returned `workflowStatus=errored`.
The audit therefore correctly **failed closed**, made no R2 object-list call and
did not prove SQL backup completion. Do NOT trigger another export.

Use the same manual audit workflow with `phase=diagnose` instead of `audit`,
the unchanged current `main` SHA and the same `AUDIT_ONLY_NO_EXPORT`
confirmation. The diagnose phase performs exactly **one** Cloudflare GET for
the already-errored Workflow instance, with step details available only to an
in-memory sanitizer in the GitHub runner. It prints **only** a bounded,
allowlisted BOR error code/category, fixed known step labels and statuses;
it never logs raw API JSON, step outputs, inputs, provider error messages,
tokens, signed export URLs, bookmarks or SQL. No D1/R2 queries or writes,
no Workflow trigger, no deploy and no database restore.

A failed Workflow may have partially exported D1 or partially uploaded to R2.
An errored status is NOT proof that no R2 object exists; investigate exact
private bucket metadata separately before any additional export request.

## Read-only partial-object check before considering a second backup

A failed Workflows instance might still have produced an R2 object. To avoid
blindly exporting production D1 a second time, the manual audit workflow
offers `phase=partial-r2`. It uses the same exact `main` SHA and
`AUDIT_ONLY_NO_EXPORT` string, but checks only the existing instance's
known deterministic R2 key (run `45090501363`). This step sends **one**
authenticated REST `GET` with the exact object prefix and produces only a
sanitized summary of object presence, size and metadata match.

`exactExpectedObjectPresent=false` means no object appeared **at that
specific key** in the completed Cloudflare REST listing; it does not prove
no other backup or partial result exists elsewhere. An errored Workflows
instance stays errored even if an object is present. The audit never
downloads the SQL and **does not** prove backup data can be restored.
A 401/403 or ambiguous listing means **no conclusion**, never absence.

Cloudflare notes that bucket-scoped R2 object API tokens do not authenticate
against `api.cloudflare.com` object endpoints. If this audit returns 401 or
403, do not automatically broaden privileges: investigate using an
independently reviewed Cloudflare dashboard read-only or S3-compatible path.
No permissions or secrets are changed by the workflow.

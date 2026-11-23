# BOR AI — one new owner-approved D1 backup, with isolated read-only verification

## Current baseline (23 Nov 2026)

The **first** owner-approved live backup `bor-ai-private-backup-45090501363-1` failed in Cloudflare Workflows. The GET-only status/diagnostic checks proved `errored` and `private_backup_export_request_failed`. An independent R2 metadata-only check verified no object **at that run's expected exact key**, not that the whole bucket is empty.

Cloudflare Workers does not implement `fetch(..., {redirect: 'error'})`; the isolated Worker now uses `redirect: 'manual'` and explicitly rejects 3xx for all export and signed-download paths. Isolated Worker was redeployed with secret to Cloudflare at [run #45093244298](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45093244298) and its trigger step was skipped.

The owner explicitly approved **one further production D1 backup attempt**, with low-traffic timing and possible Cloudflare usage charges. That approval **does not** cover additional attempts, ongoing scheduling, SQL retrieval into GitHub, main database restore, image migration or production application Worker changes.

## Before running the NEW one-time export

1. Current code must be reviewed on unchanged `main`, with the isolated backup Worker deployed using the fixed Worker-compatible redirect handling; secret installed.
2. The private R2 bucket must remain private with retention verified. GitHub backup workflow has no auto-trigger/schedule; only manual `phase=trigger`.
3. The owner must choose a **low-traffic period**, based on real request/usage volume, not solely the 100% traffic allocation. D1 export can briefly block chat access.
4. Do **not** run any new export if an unexpected existing Workflow instance was already triggered. Do not blindly retry on ambiguous errors.

## Trigger exactly ONE new Workflow instance

Manual workflow: `.github/workflows/bor-ai-private-chat-backup-release.yml`.
Select `main`, `phase=trigger`, exact current reviewed `main` SHA,
`owner_confirmation=TRIGGER_BOR_PRIVATE_CHAT_BACKUP`,
`low_traffic_confirmation=I_ACCEPT_BRIEF_D1_EXPORT_UNAVAILABILITY` and `signed_host` EMPTY.

The successful GitHub dispatch only confirms that Cloudflare ACCEPTED the Workflow request.
It is **not** proof that SQL reached R2. Use the GitHub run ID from this NEW trigger,
e.g. a numerical `45...` ID, for the separate metadata audit below.

## Inspect one *new* instance with **GET only**, no SQL

Workflow: `.github/workflows/bor-ai-new-private-backup-receipt-audit.yml`.
Inputs on reviewed `main`:
- `phase=plan`: offline tests; no Cloudflare operations.
- `phase=audit`, `reviewed_main_sha` = exact current head SHA,
  `owner_confirmation=AUDIT_ONLY_NO_EXPORT`,
  `trigger_run_id` = **new trigger workflow GitHub run ID** (not the audit run ID).

Read-only audit derives `bor-ai-private-backup-<trigger_run_id>-1` and performs
Cloudflare `GET /workflows/.../instances/... ?simple=true`, then on a terminal
instance `GET /r2/buckets/.../objects` at three **exact candidate** SQL paths
within +/-1 day of the Cloudflare Workflow's UTC start. Cloudflare returns
only status and object metadata to this audit. The script checks a completed/successful
Workflow, an exact key match, non-zero bounded size (<=64 MiB), exact
`source`, `workflowInstance`, `format` metadata, and `application/sql` MIME.
No SQL bytes, signed URL, customer content, raw step output or authentication
secrets enter logs. R2 GET 401/403, missing metadata, unexpected states, or
ambiguous duplicate keys **fail closed**.

A metadata receipt being green is NOT a completed disaster recovery demonstration:
the SQL has not been imported into a fresh protected nonproduction D1. Post-checkpoint
journaling and zero-loss recovery (#382) remain open and require a separate privacy
and migration review. Under no circumstances restore production as part of this run.

Cloudflare:
- [Workflows instance metadata GET](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/get/)
- [R2 object metadata list](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/)

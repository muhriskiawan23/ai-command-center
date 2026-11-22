# BOR AI — create the separate private chat backup R2 bucket (NOT YET APPLIED)

**Status: source-only manual provisioning workflow.** There is no evidence
that bucket `bor-ai-chat-private-backups` exists. No bucket was created,
no SQL exported, and no R2 object or user chat content was transferred
during this PR.

Manual workflow from `main`:
`.github/workflows/bor-ai-private-chat-backup-r2-provision.yml`.

- `phase=plan`: default. No Cloudflare API calls. Runs only offline tests
  for the private-bucket audit/provisioning policy.
- `phase=provision`: a resource MUTATION requiring owner approval,
  protected `production` environment, reviewed exact unchanged `main` SHA,
  independent assessment of storage cost, privacy, deletion/retention,
  and an account-scoped dedicated R2 provisioning token. Does not use the
  D1 migration credential or change existing chat/image infrastructure.

## Approved storage scope (to be reviewed by owner before provisioning)

The **new** bucket is strictly `bor-ai-chat-private-backups` and is not the
existing `bor-ai-images` image bucket. It must have r2.dev hosting disabled,
zero custom public domains and a lifecycle rule named
`bor-chat-private-backup-retention` that deletes objects under prefix
`private/bor-ai-chat/` after **30 days**. User data may still occur in
Cloudflare snapshots/backups outside the object's lifecycle; document actual
provider retention and account erasure procedures.

The owner MUST separately accept Cloudflare R2 storage/request fees,
Workflows execution fees, and any subsequent brief D1 availability impact
before LIVE export. The **USD 2 pilot OpenAI image cap does not apply to R2
or Workflows storage costs**, so do not assume blanket financial approval.

## Owner-controlled GitHub secret (never paste its value in chat)

- `CLOUDFLARE_R2_BACKUP_PROVISION_TOKEN` under GitHub
  `Settings → Environments → production → Environment secrets`.
- Create a **separate**, short-lived, least-privilege Cloudflare token with
  R2 bucket Edit scoped to the BOR AI account. Do not replace
  `CLOUDFLARE_D1_MIGRATION_TOKEN` used for image-only D1 schema writes.
- `CLOUDFLARE_ACCOUNT_ID` remains the existing private production secret.

## Phase PROVISION exact nonsecret confirmation strings

- `owner_confirmation`:
  `CREATE_ONLY_BOR_AI_CHAT_PRIVATE_R2_BACKUP_BUCKET`
- `storage_cost_approval`:
  `I_APPROVE_PRIVATE_CHAT_BACKUP_30_DAY_STORAGE_COST`
- `reviewed_main_sha`: complete current 40-character SHA from verified PLAN.

These strings MUST NOT be supplied until storage/retention/cost and privacy
risks have been independently reviewed and approved.

The workflow refuses a resource that already exists and fails closed if
Cloudflare's metadata endpoint doesn't prove absence with HTTP 404; it does
not modify or overwrite an existing bucket automatically. On separate
approval, it creates ONLY the named bucket, disables the public r2.dev URL,
sets scoped 30-day lifecycle and finally calls the metadata-only private
R2 audit from PR #401. A partial provisioning failure remains pending for
human review, not automatic deletion or retry.

Bucket creation is NOT evidence that an independent D1 backup exists;
exporting and restoring to an isolated nonproduction D1 are still separate
requirements. No in-place Time Travel restore. The active BOR AI Worker and
URL Reader remain untouched by this workflow.

Refs:
https://developers.cloudflare.com/r2/buckets/public-buckets/
https://developers.cloudflare.com/r2/buckets/object-lifecycles/
https://developers.cloudflare.com/workflows/examples/backup-d1/

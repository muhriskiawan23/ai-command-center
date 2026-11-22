# BOR AI — manual private chat backup release (GitHub Actions / phone only)

**NOT DEPLOYED.** This file describes a **future gated** release workflow.
It does not authorize the export or sharing of real users' private chat SQL.

Workflow: `.github/workflows/bor-ai-private-chat-backup-release.yml`.
Available inputs on `main`:
- `phase=plan` (default) — offline syntax/config/tests and Wrangler dry-run;
  requires **no Cloudflare backup credential** and makes **no** D1/R2 writes.
- `phase=preflight` — manual, GET-only validation of dedicated deployment and D1
  export token status, exact pinned D1 name/UUID and private R2 bucket metadata.
  Requires both tokens in the protected GitHub `production` environment but **no
  approval strings**. Makes **no** D1 export/SQL query, Worker deployment,
  private R2 object write, restore or migration. Does not prove permission to
  perform a future export or that existing backups are restorable.
- `phase=deploy` — owner-reviewed 40-character PLAN SHA, exact confirmation,
  vetted signed-download URL hostname, dedicated private R2 bucket audit
  and reviewed private backup service credential required. Deploys only
  `bor-ai-chat-backup-isolated`, with no HTTP access and NO backup/export.
- `phase=trigger` — independent owner-reviewed 40-character SHA, exact trigger
  confirmation, separate approval for the possibility that D1 export briefly
  blocks normal chat reads, and dedicated private R2 audit required. Triggers
  ONE Cloudflare Workflow instance with a stable run identifier. This does
  NOT establish a valid backup or successful recovery.

## Required independent Cloudflare/GitHub secrets

- `CLOUDFLARE_BACKUP_DEPLOY_TOKEN` (GitHub **production environment**):
  dedicated least-privilege token approved for this isolated Worker/Workflow
  deployment, Worker secret management and manual Workflow instance creation.
- `BOR_PRIVATE_D1_EXPORT_TOKEN` (GitHub **production environment**):
  separate least-privilege D1 REST export token for the pinned `bor-ai-chat`
  database. Only transferred via Wrangler standard input to Worker secret
  `BOR_D1_EXPORT_TOKEN` on the isolated backup Worker. It is **never**
  placed in Wrangler plain vars, command line arguments or GitHub artifacts.
- Existing `CLOUDFLARE_ACCOUNT_ID` plus read-only R2 audit token support
  account verification. Existing migration token is NOT required and is
  not automatically reused in the backup Worker.

## Exact approval strings for a reviewed release

- DEPLOY `owner_confirmation`: `DEPLOY_BOR_PRIVATE_CHAT_BACKUP`
- TRIGGER `owner_confirmation`: `TRIGGER_BOR_PRIVATE_CHAT_BACKUP`
- TRIGGER `low_traffic_confirmation`:
  `I_ACCEPT_BRIEF_D1_EXPORT_UNAVAILABILITY`

Never supply these strings until the corresponding live review has passed.
Never enable a scheduled export or allow auto-provisioning; the deploy phase
explicitly disables Wrangler automatic resource creation.

## Before ANY DEPLOY

- PR #400 (isolated source) and PR #401 (bucket private audit) must be fully
  merged with 4/4 exact-head green CI, and this release workflow also merged.
- Confirm `bor-ai-chat-private-backups` exists privately: r2.dev OFF,
  no custom public domains, and owner-approved 30-day prefix-scoped lifecycle
  with full privacy/erasure/retention plan. The audit MUST pass.
- Confirm D1 export signed hostname with Cloudflare documentation/verified
  provider metadata; do not accept a random URL or weaken SSRF protections.
- Confirm export size within 64MiB limit, R2 storage/billing, privacy review,
  role separation and D1 temporary availability risk.

## Before ANY TRIGGER

- Source-only tests, manual PLAN and protected bucket audit pass at the current
  unchanged `main` SHA. Independent operator confirms low-traffic window.
- Inspect the isolated Worker binding and backup export token exists as a
  Cloudflare Worker SECRET, without revealing its value.
- A trigger may asynchronously start an export and is **not** proof it has
  completed. Verify a full R2 object receipt *inside Cloudflare*, then
  independently test importing into an isolated NONPRODUCTION D1 database.
  Never expose the SQL to ChatGPT/GitHub or in-place restore primary D1.
- Time Travel restore would erase post-bookmark chats; real independent
  journal and replay #382 remains necessary.
- Until full DR proof exists, image migration APPLY #385 stays blocked.

Reference: https://developers.cloudflare.com/workflows/examples/backup-d1/
Reference: https://developers.cloudflare.com/workers/wrangler/commands/workflows/

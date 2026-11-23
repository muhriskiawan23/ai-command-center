# BOR AI — manual private chat backup release (GitHub Actions / phone only)

**Status as of 2026-11-23:** an earlier isolated backup Worker was deployed
successfully (GitHub run #45093244298), but the later polling payload fix
in merged PR #415 has **NOT** been verified as deployed. This runbook describes
future *separately approved* releases, not authorization to export or share
any real users' private chat SQL.

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

## Cloudflare Worker runtime redirect-mode correction

The one-time live Workflow instance `bor-ai-private-backup-45090501363-1`
returned `errored`, and the GET-only diagnosis produced the sanitized code
`private_backup_export_request_failed` in
[run #45092364018](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45092364018).
The initial Worker source used `fetch(...,{redirect:'error'})`; unlike browser
Fetch, **Cloudflare Workers does not implement this mode and throws TypeError
before the request is sent**. This is a strong, independently documented
explanation for the failure, but the sanitizer did not preserve the raw
exception cause, so causation is not yet proved from that single instance.

The corrected isolated Worker uses `redirect:'manual'` and explicitly rejects
all 3xx responses for both the D1 export POST and private signed SQL GET.
Never change this to `follow`. No new export or R2 write occurs merely from
merging this source code. A future isolated Worker redeploy must be reviewed
separately; any *second* live production D1 export requires a new explicit
low-traffic approval after private R2 partial-state audit and code release.

Reference:
https://developers.cloudflare.com/workers/runtime-apis/request/#redirect

## 23 Nov 2026 — source-only release candidate gate after PR #415

Before requesting a new isolated Worker deployment, the manual `phase=plan`
now builds TWO configurations, without real Cloudflare credentials:
1. The existing disabled/safe-OFF isolated backup Worker.
2. A **synthetic enabled-shaped** candidate with a literal fake account ID
   (`00000000000000000000000000000000`) and fake signed R2 host
   (`candidate-only.r2.cloudflarestorage.com`). This is the code/configuration
   shape used by the real deploy, but Wrangler is strictly invoked with
   `--dry-run --experimental-auto-create=false`.

PR preview CI also compiles the synthetic candidate on every pull request.
The generator reads no `process.env` secrets, cannot fetch production D1,
and emits no real backup. The synthetic artifact must **NEVER** be deployed.
The isolated production Worker remains on the previously deployed version
until a new separately owner-approved `phase=deploy` succeeds, including
the dedicated export secret put; GitHub source merge or dry-run is NOT deployment.

Operational sequence, each with independent evidence and authorization:
- Confirm PR checks pass for the exact current `main` SHA, then run manual
  `phase=plan` (safe source-only).
- If owner authorizes an isolated Worker upgrade, separately review the
  expected exact `main` SHA, signed R2 host, limited credentials and private
  bucket; run **`phase=deploy` only**. Inspect logs for Worker deploy **and**
  secret install success, then independently verify deployed code/version.
  This mutates backup infrastructure but must NOT trigger a D1 export.
- The two prior approved production exports are exhausted and both errored.
  **Do not run `phase=trigger`** under an old approval. A third export requires
  new explicit informed consent, a low-traffic window, and separate preflight.
- Even with a successful R2 metadata receipt, recovery from backups is not
  proven until a safe isolated nonproduction restore drill and journal/replay
  consistency checks pass. There is NO production zero-loss guarantee.

Tracking: PR #415 (polling payload correction) and Issue #382 (recovery).

## 23 Nov 2026 — fail-closed lock and deployed-version metadata inspection

The two earlier one-time production D1 export attempts have both FAILED.
The backup release workflow now rejects `phase=trigger` at its earliest
input guard, *before any credentials or Cloudflare calls*, even if old
confirmation strings are pasted again. Any third export requires a
separately approved code-change PR that explicitly removes this lock.
Do not remove it just to troubleshoot an HTTP 4xx.

To read current isolated Worker metadata without changing Cloudflare, use:

- [Manual isolated backup deployed-version audit](https://github.com/muhriskiawan23/ai-command-center/actions/workflows/bor-ai-isolated-backup-worker-version-audit.yml)
- Branch: `main`
- `reviewed_main_sha`: exact current 40-character HEAD (re-check it each time).
- `owner_confirmation`: `AUDIT_ISOLATED_BACKUP_DEPLOYMENT_ONLY`

The new audit calls only Cloudflare
`GET /accounts/{account}/workers/scripts/bor-ai-chat-backup-isolated/deployments?page=1&per_page=1`
with the existing protected dedicated Worker deploy token. The result
contains the latest active deployment UUID, creation timestamp and version ID(s)
and percentages; this is metadata only. It makes no D1 or R2 calls, no
workflow trigger, no deploy, and does not download the Worker code.
An authorization/403 response is a permission blocker, never proof of absence.

**Critical distinction:** a deployed Worker version ID confirms only which
version is active. It **does not** cryptographically prove PR #415 polling
source is in that version. For a future authorized `phase=deploy`, compare
the exact reviewed GitHub SHA, the Wrangler deployment log, the separate
post-deploy secret install result (which can create a new version) and the
GET-only active version metadata. Any uncertainty must remain unresolved,
not called a successful backup.

Cloudflare API reference:
https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/

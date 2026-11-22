# BOR AI — private D1-to-R2 backup Workflow, source-only staging

**Status 23 Nov 2026: SOURCE AND OFFLINE TESTS ONLY.** No production
Workflow has been deployed, no account/R2 resources created, no chat SQL
exported, no GitHub customer-data artifact, no D1 restore or migration.

## Architecture (based on Cloudflare's official backup example)

Cloudflare D1 export REST API `POST /accounts/{account}/d1/database/{id}/export`
→ a manually triggered isolated Cloudflare Workflow `bor-ai-chat-private-backup-v1`
→ download via the *reviewed exact Cloudflare R2 hostname* in the returned
short-lived signed URL → **direct streaming to the private R2 binding**
`PRIVATE_BACKUP_BUCKET`. The bucket is a separate intended future resource,
`bor-ai-chat-private-backups` — **it has NOT been provisioned or audited**.

The export SQL/URL/token remain inside Cloudflare. No GitHub Actions job or
output receives customer chat, raw SQL or a signed export URL. The separate
Worker's `fetch()` always returns 404; there is no HTTP trigger, schedule,
cron, production Worker binding, or content listing/public download endpoint.

This is based on https://developers.cloudflare.com/workflows/examples/backup-d1/

## Fail-closed behavior

- Generator `node scripts/prepare-chat-private-backup-staging.mjs` emits a
  **separate** `wrangler.chat-private-backup.generated.jsonc` with both
  backup flags **false**. It cannot replace `ai-command-center` or bind its
  primary D1/queues/assets.
- Only a reviewed release may set both flags to true with an exact owner
  release phrase, matching pinned D1/account, independently reviewed dedicated
  R2 bucket and a verified Cloudflare R2 signed-export host. Invalid inputs
  fail before export. No client payload can select a database, bucket or URL.
- At runtime `BOR_D1_EXPORT_TOKEN` is a separate Workflow Worker secret.
  Existing `CLOUDFLARE_D1_MIGRATION_TOKEN` in GitHub is **not** automatically
  present in that Worker. Never hardcode a token in Wrangler vars/code.
- Only manual Workflow trigger with purpose `owner-approved-private-backup`
  and stable instance ID passes the operation gate. No automatic backup calls.
- A Cloudflare-hosted export is initiated/polled; only an exact, reviewed,
  HTTPS signed host ending in `.r2.cloudflarestorage.com` may be fetched.
  Redirects, nonmatching hosts, non-SQL/HTML responses, empty data and dumps
  over **64 MiB** fail closed. If Cloudflare's actual export URL hostname
  differs, DO NOT weaken the allowlist before explicit provider review.
- SQL bytes pass through a bounded stream directly into private R2. A
  **non-sensitive** key, byte count and HEAD match are returned as receipt;
  raw content, API credentials and signed URLs never enter step outputs.
- A HEAD/size check proves only an object exists, **NOT that its SQL can
  restore a real database**. Source-only tests use synthetic text, never live
  chats.
- Export can temporarily block ordinary D1 requests; schedule a separately
  reviewed low-traffic maintenance period before the first paid or live run.

## Remaining deployment gates (do not skip)

1. Owner explicitly approves backup scope, brief potential D1 read outage,
   R2 storage/billing/retention and a low-traffic maintenance period.
2. Provision **new dedicated** bucket `bor-ai-chat-private-backups` in the
   correct account with r2.dev **disabled**, no public custom domain,
   tightly scoped storage access, encryption, approved object lifecycle,
   privacy erasure/retention plan and independent operational audit. Existing
   image R2 bucket `bor-ai-images` is NOT an acceptable chat-backup target.
3. Review a dedicated export token / Cloudflare Worker deployment credential,
   and a restricted `BOR_D1_EXPORT_TOKEN` Worker secret. Confirm export
   endpoint, actual signed download host, size headroom and error budget
   without printing any customer data, credentials or signed URL.
4. **Separate** protected, owner-approved staging deployment of this backup
   Workflow only; no production `ai-command-center` Worker deploy or URL
   Reader change. Manual trigger only. Confirm object stored in private R2.
5. On the Cloudflare side, independently verify the exported backup can be
   recovered into a new **non-production** D1. Compare confidential hashes,
   message counts, schema, ownership and deletion tombstones privately.
   Do not restore the primary D1. An external checked snapshot still does not
   preserve post-checkpoint chat events after disaster: independent journal
   integration #382 is required for that RPO guarantee.
6. Only after recovery evidence has actually been reviewed, revisit the strict
   image-only migration PLAN/APPLY for 0012 and 0016. Images remain OFF until
   OpenAI secret and private R2/Queue bindings are verified; user-approved
   image pilot remains USD 2, with no unreviewed provider call.

## Sources

- https://developers.cloudflare.com/workflows/examples/backup-d1/
- https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/
- https://developers.cloudflare.com/workers/wrangler/commands/workflows/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/r2/buckets/public-buckets/

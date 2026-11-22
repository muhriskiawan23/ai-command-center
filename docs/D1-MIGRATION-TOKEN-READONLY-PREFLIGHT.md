# BOR AI — dedicated Cloudflare D1 Edit token probe (READ ONLY)

The owner reported saving CLOUDFLARE_D1_MIGRATION_TOKEN in the GitHub
production environment, but GitHub's secret list required MFA and could not be
independently inspected. The previous image schema attempt failed at the D1
/query endpoint with Cloudflare code 7500. The last successful read-only
PLAN proved that the expected 0012 and 0016 image migrations are still
pending; it used a DIFFERENT audit token.

To verify the new token WITHOUT applying migrations, manually dispatch:

    .github/workflows/bor-ai-d1-write-token-readonly-preflight.yml

It has no inputs and can run only from main in the protected production
environment. The exact repository-pinned D1 ID is checked BEFORE any
Cloudflare request. Its only D1 command is literal SELECT 1 AS
bor_ai_d1_token_probe sent via Wrangler d1 execute --remote using
CLOUDFLARE_D1_MIGRATION_TOKEN. It reads no user tables and does not mutate
customer data, export any rows, deploy a Worker, retrieve a secret value, or
invoke paid image generation. A success means the new token works at the
previously denied D1 query API endpoint; a failure must not be bypassed.

Still required before image schema APPLY: the account owner must secure an
independent private D1 export/backup and independently verify that it can be
replayed into a separate, nonproduction D1 without leaking chat data. The
current D1 Time Travel bookmark is NOT an independent backup and restoring
it in-place would overwrite newer messages. Do not paste the private SQL
export into GitHub artifacts, commit it or upload it to ChatGPT. Cloudflare
documents exporting to R2 via Cloudflare Workflows as a possible account-side
approach, subject to private encryption, retention, access, completeness
and restoration checks.

Image Assistant still needs bound OPENAI_API_KEY, IMAGE_FILES private R2,
IMAGE_QUEUE, a working front-end/Worker release and a USD 2 pilot budget
control. This token probe is only a prerequisite.

Sources:
https://developers.cloudflare.com/d1/reference/time-travel/
https://developers.cloudflare.com/d1/best-practices/import-export-data/

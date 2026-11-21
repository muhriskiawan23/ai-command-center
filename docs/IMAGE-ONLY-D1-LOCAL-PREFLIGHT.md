# BOR AI — safe image-only D1 preflight (local, not production)

Verified from authenticated read-only Cloudflare run [#44912959060](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44912959060) on 21 November 2026:
- The pinned `bor-ai-chat` D1 name/UUID metadata matches production.
- The actual pending migration list is **0012 image jobs**, **0013 billing foundation**, **0014 billing invoice guard**, **0015 sandbox billing recovery**, **0016 image-chat history**. **None has been applied in production.**
- Active Cloudflare R2 audit requests are **denied**; bucket existence and private domains remain unknown. Image Queue is absent. Paid Image API is OFF and the existing URL Reader is ON.

## Proven image-only scope

To test only the intended image features without executing any remote SQL:

```sh
node scripts/image-only-d1-preflight.mjs
node --test tests/image-only-d1-preflight.test.js
```

This uses ephemeral SQLite `:memory:`; it loads the 11 previously-applied baseline migration files followed by **only** `0012_image_jobs.sql` and `0016_image_chat_history.sql`. It excludes 0013–0015 completely, checks expected ownership and credit triggers, an atomic reserve/refund and FK integrity. It never imports credentials, calls Cloudflare or changes remote D1.

**Important:** this is a local schema proof **only**. It is *not* a production migration plan that can be run as-is, and it does not authorize manually running SQL against production. Do not delete the unapproved billing migrations, edit `d1_migrations` to mark them applied, or bypass `scripts/check-production-migration-isolation.mjs`. A reviewed isolation strategy for using `migrations_dir`, a D1 Time Travel bookmark and rollback playbook, and strict change approval are prerequisites to any production migration.

## Remaining production launch gates

A separate approved plan must resolve: R2 inspection permissions and privacy, Queue provisioning, worker bindings, OpenAI API Platform eligibility and spending limits, tariff accounting, URL Reader security issue #156/#351 and Reader-preserving deployment without paid-image activation, and Media Lab asset smoke. No customer image creation/editing may be advertised while the image feature is OFF.

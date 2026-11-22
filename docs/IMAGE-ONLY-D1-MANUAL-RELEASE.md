# BOR AI — image-only D1 migration: recovery-first manual release

**Status (22 Nov 2026): PLAN PASSED, PRODUCTION APPLY NOT AUTHORIZED.**
This runbook does not authorize a Worker deploy, paid OpenAI call, image-credit grant, billing migration, D1 restore, or new Cloudflare resource. Preserve the active URL Reader independently (issues #351 and #156).

## Grounded state and isolation

- Production database: existing **`bor-ai-chat`**, pinned to the D1 binding in `wrangler.jsonc`. Preserve chat records and existing login/session behavior.
- Exactly two pending image SQL files: `0012_image_jobs.sql` (image jobs, wallet/ledger reservation/refund, lifetime pilot meter) followed by `0016_image_chat_history.sql` (nullable conversation association). No billing migration may be applied here. All base migrations `0001–0011` are untouched.
- The most recent owner-initiated read-only `plan` [run #44989444517](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44989444517) passed on reviewed main SHA `fe1a1c7d5a70fc8f5449eb73bc2bff84ff2a009b`. The exact remote pending set matched those two migrations; 17 local isolation tests passed. It queried pinned D1 metadata and a Time Travel bookmark through GET only; **no SQL was applied**.
- Dedicated R2 `bor-ai-images`, no public R2 domains, exactly one enabled seven-day lifecycle scoped to `images/`, and Queue `bor-ai-image-jobs` are independently verified by [read-only run #44989333322](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44989333322). Neither storage nor Queue is currently bound to the active Worker; paid Image Assistant remains OFF.

The image-only workflow `.github/workflows/bor-ai-image-d1-release.yml` is manual-only, always runs from `main`, compares standard/isolated remote migration listings, and uses a locally generated, Worker-less Wrangler configuration containing **only** the two approved image SQL files. Never run production `d1 migrations apply` against the ordinary migrations directory or use the normal Worker deploy as a substitute.

## Recovery review — owner action required **before** any APPLY

1. Confirm which Cloudflare account and exact production D1 `bor-ai-chat` are active. Confirm D1 Time Travel availability **and** the database's production backend; the presence of a GET bookmark is useful evidence but not itself a recovery exercise.
2. Independently obtain a **current, exact recovery bookmark or UTC restoration point** using the owner's authenticated Cloudflare environment (for example, `npx wrangler@4 d1 time-travel info bor-ai-chat` in the owner's private terminal). Store the full recovery information and timestamp in a **private operator-controlled location**; never paste into ChatGPT, a GitHub issue, repository, Action output, or PR comments. The fingerprint printed by the CI preflight is **not a usable restore bookmark**.
3. Confirm the applicable Cloudflare Time Travel window: **7 days on Workers Free or 30 days on Workers Paid**, and rehearse the *procedure* using a safe, **separate synthetic database** if available. Do not restore the live database merely to test it. A real Time Travel restore overwrites the database in place, cancels in-flight queries and can erase newer customer chats. It is an **emergency last resort**, not a routine rollback.
4. Decide and document the human incident response: who is authorized to freeze writes, how to halt image operations, how to check which of `0012`/`0016` actually applied, and whether a forward-only schema correction can avoid overwriting newer chat data. Capture a private pre-change evidence record and pick an appropriate low-traffic window.
5. If a separate full-data SQL export is deemed necessary, conduct a distinct privacy/security review first. `wrangler d1 export --remote` **can block other database requests**, and exported SQL contains private user/chat data. Do **not** export production chat data into GitHub Actions artifacts, R2 image storage, this conversation, or an unapproved third-party service. Cloudflare warns that virtual tables may prevent export and large SQL statements may complicate re-import, so an untested dump is not a verified recovery procedure.
6. Review expected customer impact, operational cost, session continuity and this exact main revision; obtain **separate, unambiguous owner approval** to modify the production D1 schema. A generic “continue” or previous successful `plan` does not constitute this approval.

Reference documentation: [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Workflow input contract

Run the manual workflow on **main** with `phase=plan` to inspect; it is read-only. If that plan fails or the repository's `main` commit changes, resolve the drift and rerun `plan`. A successful PLAN alone does not authorize APPLY.

Only *after* all recovery and security prerequisites are independently reviewed and the owner **explicitly authorizes a live schema change**, the controlled `phase=apply` requires **all**:

- `confirmation=CONFIRM_IMAGE_SCHEMA_0012_0016_BOR_AI_CHAT` — exact human confirmation.
- `reviewed_plan_sha=<exact 40-character main commit SHA>` — must equal the dispatch commit SHA of the successful PLAN that was reviewed. The workflow also rechecks that remote `main` has not moved before SQL writes.
- `recovery_attestation=PRIVATE_D1_RECOVERY_EVIDENCE_REVIEWED` — the operator asserts that a usable private recovery procedure and evidence were reviewed. The workflow **cannot independently certify that a backup exists**; this input is an acknowledgment, not proof.
- `production` GitHub environment safeguards and passing exact remote migration/bookmark preflights.

No single input can bypass all gates. `apply` uses only the isolated image migration list, and the follow-up step checks for zero remaining image migrations. No Worker deployment, OpenAI request or Image Assistant activation occurs as part of schema apply.

## If the APPLY fails or production chat degrades

**Stop.** Do not blindly retry `apply` or restore D1. Record which migrations actually applied using the read-only remote migration inventory; check application health, sessions and message persistence. Choose a non-destructive forward fix where possible, with separate review and authorization. If destructive Time Travel restoration is unavoidable, have the owner explicitly authorize it knowing that newer chats will be lost; preserve any legally permitted evidence and recovery controls securely, and verify health and D1 state afterward.

## Independent launch gates still open

- OpenAI API Platform credit, eligibility, model pricing, spend controls, independent image wallet tariffs, secret installation, and **separate** pilot-call authorization.
- A Reader-preserving **reviewed** Worker/Media Lab release (current repository baseline would disable the active Reader if deployed unchanged), plus R2/Queue Worker bindings and scheduled cleanup with retention intact.
- Issues [#351](https://github.com/muhriskiawan23/ai-command-center/issues/351) (release delta) and [#156](https://github.com/muhriskiawan23/ai-command-center/issues/156) (URL egress/privacy) remain open; no production browser automation activation.

Even after a successful D1 schema apply, BOR AI Image Assistant is **not live** until those distinct gates are satisfied.

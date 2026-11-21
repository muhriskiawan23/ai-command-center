# BOR AI image-only production D1 release — plan first

**Status: DRAFT / NO PRODUCTION APPLY AUTHORIZED.** Adding this workflow does not approve migration, turn on images, enable OpenAI, create storage or deploy a Worker. In particular, the currently active Tavily URL Reader must remain unchanged.

## Why separate it from normal deploy?

The normal BOR AI production deploy deliberately blocks image and D1 changes while preserving the active Tavily Reader. Therefore a reviewed **database-only** schema change must not be coupled to a Worker replacement. This manual workflow uses the *existing pinned* production `bor-ai-chat` D1 with an isolated Wrangler configuration containing only image migrations `0012_image_jobs.sql` and `0016_image_chat_history.sql`. It has no Worker main, assets, R2, Queue, binding secrets or new runtime features. It cannot use the three synthetic billing SQL files now stored under `staging/billing/synthetic-reference/`.

## Safe plan phase

An authorized operator may eventually dispatch `.github/workflows/bor-ai-image-d1-release.yml` on `main` with `phase=plan` (the default). It verifies the production migration isolation guard, source migration tests and only two generated image SQL files. It compares **both** standard and isolated remote migration lists against the exact expected pair (no missing, extra, reordered or duplicate migration) and verifies pinned D1 metadata and Cloudflare Time Travel bookmark through **GET only**. If any result drifts, the operation fails closed.

`phase=plan` performs **no D1 apply or Worker deploy**. Do not confuse this with an image-service launch or a paid provider smoke test.

## Apply phase (separate explicit owner/security approval still needed)

No one should select `phase=apply` until a human has reviewed the current production data, full pending list, backups/restore access, retention window, user impact, and costs. The workflow also requires exact confirmation `CONFIRM_IMAGE_SCHEMA_0012_0016_BOR_AI_CHAT` and the `production` GitHub environment; these gates are additional safeguards **not substitutes for approval**.

Before applying, check all existing production D1 history, consider concurrent writes, capture independent restore evidence and plan a non-destructive forward fix when possible. Cloudflare Time Travel restoration can lose newer user chats and may not be available outside plan retention. A bookmark fingerprint in CI **is not a recoverable bookmark**; retain actual recovery instructions only in a secure operator-controlled environment.

The `apply` step uses the isolated config and only the two image migrations, followed by another remote read-only pending-list check. It does **not** deploy the Worker, change Tavily Reader or enable the Image Assistant. If the apply fails partway, do not blindly retry or restore: inspect actual migration status first and perform an incident review.

## Remaining independent launch gates

- Verify R2 bucket existence and privacy through an approved least-privilege R2 audit credential (the existing audit reports `denied`, **not absent**).
- Independently review Queue provisioning and billing implications.
- Install and attest OpenAI Worker secret only with owner authorization; verify API-platform credit and pilot unit economics.
- Keep `BOR_IMAGES_ENABLED=false` until release review, migration success, resource privacy, caps, and paid pilot consent.
- Preserve currently active URL Reader with the independent security gate (#156 and #351), and verify user-facing Media Lab assets in a separately reviewed deploy.

**Current grounded evidence:** image-only remote listings passed [read-only run 44915881424](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44915881424). After source billing isolation, [read-only run 44916993965](https://github.com/muhriskiawan23/ai-command-center/actions/runs/44916993965) lists only 0012 and 0016 as pending and reports a current D1 bookmark available, while Image Assistant is still OFF.

See also `docs/IMAGE-ONLY-D1-MIGRATIONS-READONLY.md` and `docs/IMAGE-READONLY-INFRA-D1-TRIAGE.md`.

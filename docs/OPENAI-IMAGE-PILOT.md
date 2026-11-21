# BOR AI — OpenAI image pilot (no automatic activation)

Status: **NOT LIVE**. This is an opt-in staging/pilot hardening change, not approval to turn on customer-paid image generation or to spend the owner's API credits. Keep `BOR_IMAGES_ENABLED=false` until all release gates are verified.

## What $5 does and does not mean

- A reported $5 OpenAI credit balance must be **API Platform** credit, not a ChatGPT subscription or ChatGPT usage wallet. This repository cannot attest to anyone's API balance, expiration, org verification, rate limits, or automatic recharge settings.
- This pilot allows only `gpt-image-2`, one `1024x1024` image per job, `quality: low`, one per user per UTC day, two jobs globally per UTC day, and an explicitly configured **lifetime cap of 1–10 admitted jobs** across all users and days. Canceled, failed, unknown-status and expired jobs still count: they may have consumed provider credits.
- The cap is a **request-count guard, not a precise USD spending limit**. Provider input tokens, media input, changing rates, network uncertainty, and other API consumers can spend additional funds. The operator must set a separate OpenAI project/org spend threshold and disable auto-recharge. Never advertise this as a mathematically guaranteed $5 cap.
- No provider API key is checked into GitHub. `OPENAI_API_KEY` is a **Cloudflare Worker secret**. Do not paste keys into chat or GitHub issue comments. Never set an API key in browser JavaScript.
- The independent image wallet is not a live subscription wallet. No real credits are granted from payments in this pilot; public general activation is not authorized.

## Activation prerequisites (separate reviewed release)

1. Confirm the active OpenAI API credit balance/expiry and organization verification, then set OpenAI-side spend limits and alerts with automatic recharge off.
2. Finish billing and marginal-cost controls: exact tariff/cost tests for generate **and** edit, refunds/chargebacks, credit reservations, API consumption metering, account ownership, and a pilot-only eligible audience.
3. Ensure production image migration `0012` is independently reviewed and isolated from any synthetic billing migrations. Confirm existing primary D1 identity and rollback/bookmark **before** making any schema changes.
4. Provision and review private R2 bucket, retention policy, Queue and Worker secret; never mix with sandbox D1. Make a non-paid preview build first.
5. Set reviewed deployment variables: `IMAGE_CREDITS_GENERATE`, `IMAGE_CREDITS_EDIT`, `IMAGE_TARIFF_VERSION`, `IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT` (integer 1–10), plus `BOR_IMAGES_ENABLED=true` only for the explicitly approved pilot.
6. Run exact-head CI, candidate tests, and security review of the URL Reader production delta. Do not replace active external-link reading blindly just to ship media assets. Release `/media-lab.html` local image tools separately when safe.
7. Perform a **single explicitly approved** paid image smoke with an owner-controlled account; reconcile OpenAI usage after completion. Never infer a zero cost from timeout or error.

## Fail-closed invariants

- Missing/invalid pilot limit, unsupported model or quality, absent DB/R2/Queue/secret, and missing tariff disable generation.
- A single atomic D1 INSERT checks both daily quotas and the lifetime total **before** enqueuing a paid request. No retry of already claimed provider calls.
- Provider errors cannot disclose response bodies or secrets to the user.
- The Local Media Lab does not transmit selected photos to OpenAI; it remains free and local until a separate explicit server-backed AI image flow is enabled.
- URL Reader/Browser Automation are separate security and billing launches. Do not treat an image pilot as consent to enable them.

Source documentation to recheck before activation:
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/pricing
- https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform

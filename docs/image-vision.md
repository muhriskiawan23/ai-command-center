# BOR AI — true image understanding (Cloudflare Workers AI)

## User flow

1. Select a JPG, PNG, or WebP (up to 5 MB). The browser decodes the selected file and draws it onto a local canvas, downscaling until the resulting JPEG data URI is at most 760,000 characters (about 557 KiB compressed).
2. BOR AI displays the attached photo; **no upload happens before Send**.
3. On Send, `/api/chat` receives `imageVision: {name, dataUrl}` with `X-BOR-Vision: 1` in the same user message. No OCR web worker / language-pack download is used.
4. The Worker validates MIME, filename and JPEG signature, enforces request size and daily quota, then calls `@cf/moondream/moondream3.1-9B-A2B` through its existing `env.AI` binding.
5. Only the bounded, model-generated **visual observations** go into the text assistant context. The second model answers the user's natural-language question.
6. If the user is logged in, D1 stores the ordinary user message with a safe filename marker, and the assistant's answer. **Raw JPEG data, base64 content and internal visual prompt are not persisted in chat storage.** Browser preview is session-only and disappears after refresh.

## Limits and costs

- 1 image per turn; accepted uploads: JPG/PNG/WebP, max 5 MB locally, max 560 KiB JPEG through chat JSON.
- Visual chat costs **3 daily quota units** (one normal chat unit + two additional vision units), and uses existing per-IP/per-user rate limits and global D1 quotas.
- Cloudflare Moondream 3.1 rate as listed in October 2026: **$0.30 / 1M input tokens**, **$1.00 / 1M output tokens**. Actual cost per photo depends on the image and token consumption; vision output is capped at 650 tokens before the regular chat model. Do not imply this equates to a fixed per-image price.
- Worker feature flag: `BOR_VISION_ENABLED=true` in wrangler.jsonc. Existing AI binding is reused; no additional secret key, Tavily or Midtrans dependency.
- Input is routed to Cloudflare's model for processing, so do not claim uploaded image pixels stay exclusively on the device. Cloudflare data policies apply.
- OCR for scanned PDFs remains a separate existing path and is not replaced here.
- Image follow-up after a page reload is limited to previously generated textual descriptions, not reaccess to raw pixels. One image/turn only. This is genuine visual reasoning, not capability parity with ChatGPT.

## Failure handling and safety

- Unknown or invalid payloads are rejected with 400/413 before quota or inference.
- Explicit 503 when the feature is not enabled; model failure/timeouts use existing bounded AI error path and refund usage units. No fabricated answer if vision fails.
- The model is explicitly instructed to treat image content as untrusted data. Text agents are told that visual observations can be incomplete, not to follow instructions from the image.
- Raw image bytes and base64 never reach logs, persisted messages, citations or returned JSON.
- The image never goes to an arbitrary image URL; only an inline base64 data URI reaches the configured Cloudflare AI binding.

## Release checklist

1. Confirm unit test, preview, synthetic E2E and mobile matrix green.
2. Test a photo of an ordinary object, a screenshot with UI text, and a diagram. Verify model answers visually grounded details without OCR download.
3. Confirm returned model response has valid `answer` and that the Cloudflare account has a supported Workers AI billing/quota setup.
4. Review Workers AI Neuron usage in Cloudflare analytics and D1 daily_usage quotas. No unbounded multi-agent recursion for vision turns.
5. Deploy from reviewed main through existing production workflow, preserving existing D1 migration safeguards. Do not deploy from this PR without review.

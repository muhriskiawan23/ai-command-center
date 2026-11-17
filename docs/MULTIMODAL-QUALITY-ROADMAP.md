# BOR AI Multimodal — Build & Quality Gate (draft, 18 Nov 2026)
**Status**: Unreleased design and local prototype on Draft PR #264. No AI
image/video provider has been called and no production feature/billing enabled.

## Product principle
- Paid subscription status is automatic: Basic = Free + Basic features;
  Pro = Free + Basic + Pro. There is no downgrade mode or double-grant.
- Do not promise "better than ChatGPT/Claude" without controlled,
  reproducible testing. Aim to differentiate where BOR AI can **actually**
  create more value: Indonesian-first UX, transparent cost-before-run,
  workflows integrating mixed image/video/documents, reusable asset history,
  reference consistency, and checkable citations/timestamps.
- The existing Free chat, specialist modes and multi-agent remain Free.
  Current paid catalog is not a claim that media AI is already purchasable.

## Feature matrix: current vs proposed (not active)
| Feature | Free | Basic (proposed) | Pro (proposed) |
|:--|:--|:--|:--|
| Existing chat, text analysis, modes and multi-agent | Yes | Inherits | Inherits |
| Local photo effects, downloadable PNG | Local preview | Same | Same |
| Local video keyframes, no semantic AI | Local preview | Same | Same |
| Ask questions about uploaded pictures / basic OCR | — | Yes, credit-metered | Inherits + more credits |
| Text-to-image & wallpaper generator | — | Yes, approved size/volume | More details/priority only if measured |
| Prompt-based edits and effects on photo | — | Single reference, credit-metered | Multi-reference and more capacity |
| Video Q&A + timestamped storyboard | — | — | Yes, initially sampled frames |
| Audio transcript and full continuity understanding | — | — | **Future**, not promised before evidence |
| Project asset history, repeatable styles, provenance | — | Candidate | Advanced candidate |

No fixed included image/video quotas are authorized yet: measure
provider actual cost, latency and safe margin first. Include monthly
credit envelope, per-request max, daily budget, account-level and global
provider ceilings, per-feature cost quotes, exactly-once wallet reserve/
finalize, slow-queue timeouts and cancellation recovery. Never silently
send every video frame to paid model calls.

## Technical prototypes added
- `src/multimodal-inference.js` and `multimodal-metering.js` connect model
  contracts to actual entitlement/budget/credit adapters with per-attempt
  append-only media usage evidence, bounded provider deadlines and held-funds
  failure handling. Integrated SQLite tests use synthetic provider receipts;
  no live adapter/production route is installed. See
  [Multimodal billing integration](MULTIMODAL-BILLING-INTEGRATION.md).
- `src/multimodal-contract.js`: strict data URI-only PNG/JPEG/WebP
  input, byte/image-dimension bounds, prompt and output dimension
  validation, supported feature labels and model-specific request builders.
  Uses `@cf/moondream/moondream3.1-9B-A2B` image query format and
  `@cf/black-forest-labs/flux-2-klein-9b` multipart request format.
  No HTTP URL fetching/SSRF, no paid model invocation.
- `buildVideoFrameAnalysisPlan`: 1–12 frames with increasing timestamps,
  video <=120 seconds; frame-level image interpretation plan only.
  **No motion or audio understanding** from this method. A further
  temporal aggregation and audio-transcription adapter are required.
- `public/media-lab.html` + `media-lab.js`: free local photo effects,
  original remains untouched, downloadable PNG; local MP4/WebM
  keyframe storyboard. Media does not leave the user's browser via this
  page; it never invokes an LLM or stores media server-side.
- `tests/multimodal-contract.test.js` and
  `tests/e2e/media-lab.spec.js` cover upload limits, spoofing,
  Cloudflare multipart, timestamps, local editing and media privacy.

### Media and subscription hardening (18 Nov 2026)
- Shared browser/Worker `public/media-validation.js` rejects header-only
  files, incomplete containers, bad PNG chunk checksums, mismatched WebP
  sizes/canvas, invalid JPEG segments, animation and trailing PNG/WebP data.
  Preflight runs before browser photo decompression. This is **container
  validation**, not a full compressed-bitstream decoder or content moderation;
  a bounded server decoder/re-encode remains a paid-dispatch release gate.
- A video request's frame bundle is capped at 12 MiB in aggregate, in addition
  to the existing 4 MiB/frame, 12-frame and 120-second limits.
- Local video extraction waits for decoded data, cancels on source changes,
  cleans listeners/URLs on cancellation, and never appends stale frames from
  an older job. Re-selecting the same file works. Synthetic WebM E2E tests
  cover five-frame extraction, cancellation and zero media uploads.
- The HTML security policy explicitly permits same-origin/blob media;
  external media hosts remain blocked. Tabs support arrow/Home/End keys.
- The plan API returns server-derived expiry/recheck timing. Visible tabs
  recheck at expiry or within 60 seconds, and on focus/visibility resume.
  Server authorization remains authoritative on each protected request;
  polling never grants credits or extends a subscription.
- Specification references for the container checks:
  https://www.w3.org/TR/png-3/ and
  https://developers.google.com/speed/webp/docs/riff_container .

## Provider evidence (recheck before deployment)
Official Cloudflare Workers AI:
- Moondream 3.1 (image-to-text, image data URI, question/answer, pricing):
  https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/
- FLUX.2 Klein 9B image generation & multi-reference editing (4 input
  images, multipart binding, max reference resolution):
  https://developers.cloudflare.com/changelog/post/2026-01-28-flux-2-klein-9b-workers-ai/
- Cloudflare pricing (model-specific paid units; neurons, free quota,
  account/plan constraints need verifying):
  https://developers.cloudflare.com/workers-ai/platform/pricing/
- Cloudflare vision tutorial:
  https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/

All model availability, licensing and output pricing are subject to provider
policy, account access and model changes. A model's image/video input
availability does **not** grant BOR AI rights to call it, prove safety,
guarantee a feature, or make it economically viable.

## Security, privacy, content and reliability
1. Server must check authenticated user, current paid entitlement,
   protected feature, file magic/MIME and dimensions, decoded size,
   image content moderation/abuse limits, provenance, retention and
   private access before ANY billable dispatch. Media content is untrusted.
2. Verify source file ownership/consent, disallow external arbitrary
   image URLs, deny unsafe formats, cap decoded pixels/video dimensions,
   apply decompression limits and use safe content type downloads.
3. Generated media must be clearly labeled AI-generated/edited; maintain
   before/after and no secret uploads. Avoid exposing private image data
   in traces and logs. Expire artifacts and support user deletion.
4. Design billing/metering per provider: image MP, number of references,
   model rate version, video frame count and possible audio minutes.
   Reserve an upper bound **before** processing. On unknown provider
   outcome, retain a hold pending attested reconciliation; do not double
   debit retries. A confirmed failed job is released only after durable
   no-dispatch / provider-no-charge proof.
5. Downscale/validate image references for the chosen FLUX provider
   (<512x512 as documented); use local preview to obtain approval to
   send user media. No automatic upload from the local studio.

## Honest release acceptance criteria
A. User can upload JPG/PNG/WebP, ask the model a question and receive a
   grounded answer with bounded latency and explicit uncertain claims.
B. Text-to-image and wallpaper output is an actual downloadable image;
   photo edit respects source and includes before/after; references do
   not leak to other users.
C. A real video upload produces timestamped, grounded visual events and
   is labeled *frames-only* unless motion/audio are actually processed.
D. Verify all Free/Basic/Pro permissions per endpoint, credit charging,
   expired/refunded subscriptions, simultaneous requests, deep retry,
   cancellations, malicious file abuse and failure states.
E. Benchmark at least 100 Indonesian-language image Q&A examples, 50
   edit prompt/reference pairs, and 30 short videos with human-reviewed
   ground truth. Record measured pass rates, hallucinations, cost/image,
   cost/minute, latency p50/p95 and accessibility/mobile support. Claims
   of outperforming any other AI require matched prompts and conditions
   with date/source and independently repeatable scores.
F. Obtain external invoice/model usage evidence, review safety and
   security/privacy licensing, merchant billing approval and founder
   signoff before enabling ANY paid model dispatch in production.

**NO MERGE / DEPLOY / PAID CALL / REMOTE MIGRATION by this document.**

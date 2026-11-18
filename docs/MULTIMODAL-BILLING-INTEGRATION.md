# Multimodal execution and finance integration

Status: opt-in prototype on Draft PR #264. Its authenticated media HTTP boundary
is disabled in all checked-in deployment configurations and requires trusted
server runtime wiring. See [HTTP boundary](MEDIA-HTTP-BOUNDARY.md).
No paid AI calls, remote migrations, real receipts or customer charges have
been performed by this implementation. The existing local Media Lab remains
local-only and does not upload media to this coordinator.

## Implemented execution contract

`runMultimodalInferencePrototype` joins the existing model request builders,
server entitlement resolver, actual provider/global D1 budget and credit-ledger
adapters, and a separate immutable media-usage journal. It supports image Q&A,
image generation/wallpaper, reference edits and sampled visual video frames.

The caller supplies **server-authenticated** identity/request IDs, a trusted
versioned tariff registry, a provider invocation adapter and a separate trusted
measurement adapter. No production wiring/default prices are installed. The
request object accepts only a known action and that action's bounded inputs;
client model, feature, tier, credit and price overrides are rejected.

1. Build and validate the actual operation. Resolution and number of references
   determine the feature gate, even if a client labels an edit as generation.
2. Require explicitly enabled entitlement checking and verify the active tier.
   Free cannot dispatch; Basic cannot dispatch video, multi-reference or
   high-detail operations. Pro retains its automatic inherited access.
3. Quote the entire job and reserve maximum provider/global exposure and customer
   credits before the first model call. Retry/concurrent reuse of the same opaque
   job ID cannot reserve or dispatch twice. Every frame shares the job envelope.
4. Recheck entitlement/cancellation before each frame, commit its immutable
   dispatch marker, then invoke with a bounded deadline and abort signal.
5. Require a trusted measured receipt matching the exact request, attempt,
   provider, model and tariff version. Journal its positive integer micro-USD
   cost before settlement. A provider response's own `measured:true` is not
   authoritative. The receipt adapter must independently validate actual billing
   and token/unit limits; this adapter remains unimplemented for live Cloudflare.
6. Validate bounded output; generated image dimensions must match the quote.
   Return results only after both provider-budget and wallet settlement succeed.

Before any dispatch marker/model call, a confirmed cancellation can release both
reservations. A lost journal acknowledgement, timeout, in-flight cancellation,
invalid receipt/output, partial video job or financial settlement failure retains
unresolved reservations for review. Aborting a network request does not prove
that the provider did not charge. Late callbacks cannot settle or publish output.
Usage measurement and output validation receive their own per-step abort signals,
which abort at the call deadline as well as on whole-job/client cancellation.
Adapters should pass these signals to cancellable I/O; ignoring cancellation does
not allow a late result to settle credits or return media.

Video output is explicitly `sampled_visual_frames_only`, with timestamps and
`audioAnalyzed:false`. There is no audio processing or temporal synthesis yet.

## Pricing units and bounds

`cloudflare-media-adapter.js` supplies an optional invocation adapter using
the native `AI.run` binding and the documented Moondream answer / FLUX base64
image schemas. It rejects unknown models, remote vision URLs and malformed
outputs, caps responses, and does not retry. It is tested with a simulated
binding, including composition with the actual finance coordinator. It has
not been invoked against a live account. It supplies no trusted billing
receipt adapter and is not enabled by the checked-in deployment configurations.

`multimodal-metering.js` separates token-based vision quotes from conservative
image-megapixel reservations. It requires explicit positive integer rates,
credit conversion, job spend/credit ceilings and a call deadline (at most 45 s).
The image quote reserves a first output MP, extra output MPs and each reference
image MP rounded upward separately. MP size/rounding/rates are supplied by the
server policy and must be verified against actual upstream bills before use.
This can deliberately over-reserve; only an independently measured receipt may
determine settlement. Unknown cost is never interpreted as zero.

Official reference sources checked 18 November 2026:

- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/
- https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/

Published units and availability are not evidence of this account's actual
billing, safe customer prices or approved plan quotas. Rates in integration
tests are fixtures, not an authorization to use those rates commercially.

## Journal, privacy and review

Unapplied migration `0017_media_usage_events_draft.sql` stores opaque financial
scope, feature, event kind, measured micro-USD and time. It stores no prompts,
photo/video bytes, answers or direct user identifiers. Opaque job references can
still be joined to financial reservations; they are pseudonymous, not anonymous.
Retention/erasure of financial evidence needs a separately reviewed policy.

UPDATE, DELETE, conflict-driven REPLACE and UPSERT rewriting are rejected even
with SQLite recursive triggers disabled. Terminal events require the exact
matching prior dispatch, and cannot overwrite a measured outcome.

`inspectMediaBilling` makes one read-only SQL snapshot. It flags held jobs,
unresolved attempts, orphan/mismatched financial references, measured-vs-settled
provider cost discrepancies and invalid post-dispatch releases. It never repairs
or refunds anything, never exposes per-user records, and always returns
`providerInvoiceVerified:false`. A clean arithmetic report is not an invoice
attestation or proof that the configured credit conversion is profitable.

The shared `inspectDraftBillingReconciliation` financial snapshot now pairs
both text (`ai:<wallet-request>`) and media (`media:<request>` in both tables)
reservations, checks their actual wallet journals and shared daily counters,
and flags ambiguous historical text/media aliases. Tests include both kinds of
settled jobs in one actual SQLite snapshot; the audit performs no repairs.
It does not check model usage or attest invoices. The separate earlier Stage 3
token-only usage audit still does not cover this media journal. Combined
production usage reconciliation remains a release gate; do not interpret
token-only missing-usage alerts for `media:` jobs as proof of free media usage.

## Verification and remaining integration

`tests/multimodal-inference.test.js` runs actual D1-compatible SQLite migrations,
entitlements, budget triggers, ledger and append-only journal with fictional
receipts and synthetic media. It covers package/tenant separation, concurrent
retries/global ceilings, token-vs-MP pricing, receipt mismatches, unknown outcomes,
mid-video revocation/cancellation, deadlines and late callbacks, output limits,
settlement failures, immutable history and read-only audit flags.

The optional real PNG pixel decoder/re-encoder and browser JPG/WebP-to-PNG
preparation are implemented; see [pixel preflight](PNG-PIXEL-PREFLIGHT.md).
The opt-in authenticated quote/execution/status HTTP boundary and whole-job
deadlines are now implemented and synthetically tested. Still required: a durable
job queue, reviewed codec wiring/resource limits and real moderation/retention,
live validation of the native provider adapter and trusted receipt adapter, live metering/invoice reconciliation,
combined token/media financial audits, Indonesian output-quality evaluation,
audio integration, merchant payment lifecycle and production rollout checks.

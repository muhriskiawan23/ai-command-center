# Bounded PNG pixels and local upload preparation

Status: implemented and tested code on Draft PR #264; no production activation.
This replaces **container-only validation** for the supported PNG subset with
actual decompression, pixel reconstruction and metadata-free re-encoding.
It is not semantic moderation, invoice verification or a universal image codec.

## Server codec

`src/png-preflight.js` uses only Web APIs supported by Workers: Compression/
DecompressionStream with zlib/deflate, Streams, Blob, typed arrays and base64.
No network, storage, Node runtime, external package or paid service is used.

- Accepts 8-bit, noninterlaced PNG with grayscale, RGB, grayscale-alpha or RGBA.
  Packed/indexed/16-bit/interlaced PNG, implicit tRNS transparency, APNG and raw
  JPEG/WebP are explicitly rejected by this codec, rather than silently altered.
- Checks container/CRC and dimensions first, then decodes the actual IDAT zlib
  stream. Output byte count must equal the exact scanline geometry. Broken zlib
  checksums, truncated/extra pixels and invalid scanline filters are rejected.
- Reconstructs filters 0–4, including Paeth, in one bounded scanline buffer;
  explicit alpha channels and numeric pixel samples are preserved. Re-encodes
  with filter 0 and only IHDR/IDAT/IEND. EXIF, text, compressed text, profiles,
  timestamps and other ancillary data are not copied or decompressed.
- This strips color-management metadata; it is not a color-managed archival
  editor. Browser-normalized input should already contain the intended display
  pixels. Original files are not modified.
- Caps each encoded input/output at 4 MiB, sides at 2048 pixels, and decoded
  samples at 4,194,304 pixels. Preflight also caps the whole request's aggregate
  image/reference/frame pixels at that value. Limits cannot be raised through
  this factory. Processing is sequential; compressed input feeds small pieces
  with stream backpressure and bounded expanded reads. It cooperatively yields
  during reconstruction so cancellation can be observed.

`createPngMediaPreflight` composes with the authenticated media API and preserves
request intent. It returns failure on unsupported formats or decoder errors.
`createPngOutputValidator` similarly decodes/re-encodes image output, but requires
an independent moderation callback. It does not install an unconditional pass.
The coordinator revalidates any sanitized output's shape and dimensions before
financial settlement/delivery. Mandatory moderation and metering remain separate.

## Browser preparation

`public/media-upload.js` is an optional, **local-only** helper. A caller may
explicitly pass a JPG/PNG/WebP File; it validates the bounded container before
using the browser's real decoder and canvas PNG encoder. It preserves alpha,
keeps the original File unchanged, limits normalized output to 4 MiB/2048px,
and uses <512px references. Large PNG output is scaled down with a bounded
retry count. Cancellation/timeouts and object URL/canvas cleanup are enforced.

The helper does not upload, fetch, persist files or activate any Media Lab
control. Raw JPEG/WebP should be normalized to the supported PNG subset before
using this particular server preflight. Their original compressed bytes are
not accepted by the PNG server codec.

## Evidence and limits

- `tests/png-preflight.test.js`: real pixel round trips checked against
  independent Pillow reference digests for four color types, all five filters,
  alpha and the repository icon; corrupted zlib/filter/size, expansion,
  metadata stripping, cancellation and aggregate-budget rejection cases.
- `tests/media-api.test.js`: real PNG codec through the actual authenticated
  Worker/finance route, rejection before dispatch, and sanitized generated PNG
  delivery. Semantic moderation and provider receipts remain fictional here.
- `tests/e2e/media-upload.spec.js`: actual Chromium JPEG/WebP/PNG decode and
  canvas normalization, strict reference sizing, spoof rejection/cancellation,
  no uploads, then actual server pixel decoding of the browser result.
- `tests/media/codec-workerd-proof.mjs`: exact existing locked Wrangler 4.160.0,
  disposable loopback-only workerd, no inherited account secrets, no AI/DB/
  deployment, and the same independent pixel digests. CI runs this separately
  from Node tests; a dry-run build alone is not runtime execution proof.

Still required before rollout: complete exact-head CI, independent codec/security
review and measured resource limits under production configuration, real
moderation, trusted usage/invoice metering, hosted account/model quality/cost
tests, reviewed retention/recovery, payment lifecycle and release verification.
Local workerd proof is not evidence of hosted account access or paid inference.

Primary specification/API references:
- https://www.w3.org/TR/png-3/
- https://developers.cloudflare.com/workers/runtime-apis/web-standards/

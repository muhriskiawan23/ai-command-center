# Authenticated media HTTP boundary

Status: implemented and tested with synthetic adapters on Draft PR #264.
`MEDIA_API_ENABLED` is absent from all checked-in deployment configurations;
the routes return 404 by default. No live model, payment, remote migration,
stored upload or production activation was performed.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/media/quote` | POST | Return maximum customer microcredits; no preprocessing, inference or financial write |
| `/api/media` | POST | Execute an explicitly consented media request through entitlement/budget/ledger guards |
| `/api/media/status` | POST | Read only the current account's request state using its idempotency key |

The actual Worker session and same-origin checks bind each request to its
account. Browser-supplied identity, model, tariff, credit or feature overrides
are rejected. Free is denied before upload parsing; Basic cannot bypass Pro
video, large-image or multi-reference gates. Own-account status remains readable
after refund/expiry or runtime failure while the API flag is enabled.

## Required server wiring

Execution/quote requires enabled entitlements, `MEDIA_LIMITER.limit` and a
trusted server-only `MEDIA_RUNTIME` object containing versioned `tariffs`,
`invokeModel`, `measureUsage`, `preflightInput`, `moderateInput`,
`validateOutput` and a whole-job `jobTimeoutMs` (at most 120 seconds).

The mandatory real bounded PNG decoder/re-encoder is supplied by
`src/png-preflight.js`; its supported subset and local JPG/WebP normalization
are documented in [PNG pixel preflight](PNG-PIXEL-PREFLIGHT.md). The HTTP boundary
always applies it after the custom input hook and to generated PNG output.
Verified requests/outputs are frozen before moderation; callbacks cannot waive
decoding or replace verified pixels. No semantic moderator or trusted usage/invoice verifier
is supplied here. Tests use fictional moderation/receipt implementations.
Setting a flag alone cannot make
the API usable. Native provider metrics or uploaded `measured:true` are not
trusted receipts. Preflight must perform bounded local decode/re-encode and
metadata stripping. Input/output moderation must be local and non-billable;
external or paid moderation requires its own reviewed cost/privacy reservation.

Execution requires `X-BOR-Media-Consent: send-to-ai`, a positive integer
`X-BOR-Media-Max-Credits` ceiling from a reviewed quote, and an
`Idempotency-Key` of 16–100 URL-safe characters. The coordinator recomputes the
current quote and checks the ceiling before reservations. Preflight may replace
pixel bytes, but cannot alter action, prompt/question, output geometry,
reference count or frame timestamps. Intent is captured before asynchronous
hooks and checked again after moderation.

The internal job ID hashes `[authenticated user ID, idempotency key]`.
Separate accounts can reuse the same key without sharing a request or balance.
Sequential and concurrent repeats cannot dispatch/debit twice. Customer HTTP
responses expose no provider error text/cost, raw identity, tariff version,
payment proof or another account's records.

## Bounds and unknown outcomes

Only JSON with optional UTF-8 charset and no compressed body is accepted. The
entire encoded request is capped at 8 MiB, including base64/JSON overhead.
Streaming reads enforce the cap without trusting Content-Length and cancel
oversized streams. Body reads have a ten-second bound. Per-account/global rate
limits fail closed before expensive processing.

HTTP lifetime is at most 120 seconds; `MEDIA_HTTP_TIMEOUT_MS` may lower it.
Cancellation reaches body reading, preflight, moderation and the coordinator.
The coordinator bounds the whole job, provider calls, meter and output
validation. Late callbacks cannot start new model work or publish late output.
Already-dispatched work may still be billed; uncertain reservations stay held.
Late DB acknowledgements may commit and confirmed bookkeeping may finish, but
recovery must not depend on the execution context staying alive. Durable
pre-dispatch markers and reservations support later reconciliation.

No object storage or result cache exists. Results are transient and returned
only after output validation and successful financial settlement. Existing
Media Lab controls remain local-only and do not upload to these routes.

Status returns `completed`, `cancelled` or `unresolved`, charged microcredits,
held-credit/review flags and `outputStored:false`. A completed financial request
does not prove the browser received its result. Lost output cannot currently
be retrieved: never automatically submit a new key or charge again. Reviewed
delivery/recovery/retention is still required for commercial rollout.

## Verification and remaining work

`tests/media-api.test.js` exercises the real Worker, sessions, entitlements,
credit ledger and budget/journal triggers in disposable SQLite. It covers
default-off routing, authentication/CSRF, tenant/plan isolation, quotes and
consent, idempotency/concurrency, body/type/stream bounds, rate limits,
mandatory hooks, intent preservation, whole deadlines/late callbacks,
private status after refund, output validation and financial failure states.

Still needed: reviewed decoder wiring/resource limits, real moderation/meter implementations, live model/account
and input-token-bound validation, measured cost and quality evidence, durable
queue and combined token/media reconciliation, reviewed delivery/recovery and
retention, merchant payment lifecycle, and production rollout/security/finance
verification. Synthetic tests do not prove live AI quality or invoice accuracy.

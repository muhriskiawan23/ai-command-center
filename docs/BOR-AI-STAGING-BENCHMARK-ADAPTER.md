# Staging-only Luna answer-quality benchmark adapter

The adapter imports the unchanged BOR AI core from `af5dd9b473576affbcc269b90b28e852d506ca82`. Its only route is an operator-authenticated POST to `/__staging/answer-quality-benchmark` on the existing staging workers.dev hostname. No public chat route or cron trigger is exposed by this adapter. Submitted request bodies are ignored. The six fixtures run in the existing suite order across seven turns. The follow-up retains only the synthetic conversation within its case.

## Admission and evidence

- The adapter uses the existing managed operator, OpenAI, project and D1 bindings. Activation requires a five-minute-or-shorter expiry, an explicit benchmark enable flag, the staging kill switch set to false for this operator window, and ordinary search and URL Reader disabled. The deployment review configuration remains dormant, with the kill switch true.
- Use the existing isolated D1 table `web_search_v2_live_evaluation`. The fixed ID `answer-quality-af5dd9b-v1` needs a preapproved row on that DB after independent review confirms no equivalent campaign has run on any route. Its initial status is `approved`. The evidence object must specify `candidate` (full SHA above), `expiresAt` (epoch ms, same as the runtime approval expiry), `scope` (`bor-ai-luna-staging`), `reservationMicroUsd` (500000), and `route` (`integrated-staging`). Never seed or reopen an approval automatically. The same campaign ID is required for any alternative runner to prevent double authorization.
- A single guarded UPDATE both claims the campaign and records US$0.50 reserved. US$0.24 is reserved for text and classifier, US$0.26 for one search request. The adapter admits at most 24 text/classifier requests total with at most four distinct core agents per chat turn. It refuses repeated calls for the same agent, extra provider attempts, redirects and open-ended tools. The provider path is pinned to GPT-6 Luna and OpenAI Responses. Search is restricted to one tool call. The reservation survives ambiguous or stopped runs.
- Durable evidence holds request IDs, usage, estimated costs and admitted request metadata. Synthetic answers and citations are returned to the authenticated operator for off-run scoring. Provider invoices still require reconciliation. A stopped campaign cannot be retried.
- Chat turns use the real candidate chat handler in guest mode through the capped Responses adapter. The Bennu turn exercises the candidate classifier, search provider parser, and existing D1 search reservation. The adapter does not verify real Google login, persisted user history, or the production text transport. These remain separate release gates. The search usage caps preserve existing ledger limits, so outstanding staging reservations may safely refuse this attempt.

## Verification

- Node: 771 tests, 770 passed, 0 failed, 1 skipped. The five new tests use real SQLite schema and mocked OpenAI, including concurrent claim, the six scenarios, history context, citations, replay refusal, missing approval, and uncertain provider responses.
- Wrangler 4.160.0 dry run built the staging-only module with benchmark disabled, kill switch on and no secret bindings. Bundle SHA-256: `d7efb042ae9753392859174f8e60b5059b6776826ccb2ae70eb69545edbd3925`.
- Cloudflare read-back confirmed staging uses a D1 target different from production. Its existing evaluation table has the fields needed by the approval row. No D1 write, Cloudflare upload, traffic change or live provider request occurred.
- Existing Cloudflare Browser Run REST script capability is a possible official browser execution surface after a permitted test target is available. Full local Chrome regression remains blocked by denied Unix sockets. Neither path was counted as a full browser pass.

Continue from the existing [review baseline](./BOR-AI-STAGING-MANUAL-REVIEW.md) only after a platform-approved, staged execution version is available. It must preserve the existing bindings and staging isolation. Keep all production release gates in place.

## Workers Free capacity check

- With real candidate handlers and synthetic provider responses, the seven-turn fixture completed with 30 individual D1 operations and 14 provider dispatches. Nine focused tests passed, including injected faults at all 30 D1 positions and all 14 dispatch positions, a response above 256 KiB, and the hard ceiling of 40 D1 operations. The full Node regression exited successfully with 775 test entries.
- The runner allows 38 D1 operations in flight before reserving two operation slots for completion or failure recording. Each dispatch is journaled before it leaves the Worker. Subsequent admission writes also checkpoint known receipts and completed turns. A crash can leave pending receipts in the ledger, which must be reconciled before any further use of the reservation.
- Free permits 50 D1 queries per invocation, 50 external subrequests, six outgoing connections awaiting headers, 10 ms CPU per HTTP request and 128 MB memory per isolate. The runner permits up to 25 provider dispatches with redirects denied and up to four distinct agent calls per turn. Outbound bodies are capped at 32,000 bytes and provider responses at 256 KiB each. Check remaining account request and D1 row quotas before activation. Local fixture results do not establish edge CPU, memory or end-to-end duration. Before billable execution, validate on an approved isolated runtime with synthetic responses and confirm the operator can sustain the connection throughout the approved window.

Limits: [Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing and daily quotas](https://developers.cloudflare.com/d1/platform/pricing/).

## Local workerd CPU and browser follow-up

The audited GitHub baseline was `898a0d4`. The runner and app entrypoint, search module, and pilot browser spec matched their GitHub blobs. The runner-only optimization in `165be09` reduces repeated receipt traversal and temporary arrays. The app core at `af5dd9b`, campaign authorization, per-dispatch journal, atomic reservation, kill switch, and limits are preserved.

Local workerd 2026-11-10 with Miniflare 5.20261110.0-beta ran 25 warm measurements per mode. The synthetic provider could make no external request. The full run asserts HTTP 200, seven completed turns, 14 synthetic dispatches, and 30 D1 operations. Ledger seeding and resetting private fixtures took place outside the measured request. Values below are total process CPU in milliseconds from Linux thread scheduler counters. The D1-only mode replays the 30 recorded statements against local D1/SQLite. The application replay uses the same result sequence in memory to exclude SQLite execution and D1 IPC. The Node driver runs in a separate process. Small wrapper and synthetic-provider costs are included.

| Measurement | Baseline median / p95 | Optimized median / p95 |
| --- | ---: | ---: |
| No-op | 0.91 / 1.61 | 0.93 / 1.76 |
| Local D1/SQLite only | 34.13 / 51.98 | 31.87 / 41.71 |
| Application with in-memory D1 replay | 26.33 / 44.79 | 24.90 / 31.03 |
| Full campaign with local D1 and synthetic responses | 67.34 / 93.66 | 66.90 / 83.81 |

The local trials had run-to-run variation. They do not establish the size of any improvement at the edge. In an independent V8 application replay profile, protected-output detection and normalization were the largest named self-time categories. Those checks were kept. Process high-water RSS was approximately 248 MiB baseline and 246 MiB optimized, including workerd, runtime services, local SQLite and accumulated warm-up state. This is not per-isolate heap and does not resolve the 128 MB edge memory limit. The 10 ms edge CPU gate remains open. Keep the campaign dormant until an approved isolated edge deployment passes representative synthetic runtime checks.

- The runner regression after the change passed 9/9, including failure admission, one-shot and limit coverage. The broad Node regression from the preceding audit was reused. Two cases skipped there because IPv6 loopback was unavailable passed in a local environment with IPv6. The opt-in authoritative-DNS test remains outside this offline run.
- Chromium 141 (Playwright build 1194) ran 776 local browser cases, excluding the already verified Doha regression. The initial run had 763 passes, 12 conditional viewport skips, and one attachment failure. That case passed three isolated reruns. Test-only commit `ea775d8` waits for the authenticated composer to become editable before injecting the photo, then the corrected case passed across all eight viewports. Browser login and history use local fixtures. Real staging Google sign-in and history are still separate release checks.
- No Cloudflare deployment, provider call, live reservation, or production change was made.

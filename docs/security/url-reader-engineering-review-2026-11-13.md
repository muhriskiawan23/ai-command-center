# URL Reader engineering security/privacy review — 13 November 2026

Engineering reviewer: Codex. Independent reviewer: **unassigned**.
Decision: **NO-GO: engineering audit completed; hosted negative/stability checks blocked by Tunnel availability; independent review and policy controls OPEN**.
Production URL_READER_ENABLED remains false. This is not a legal compliance opinion or an independent privacy signoff.

## Work in this change

- Extend the temporary, authenticated fixed-target probe with a successful controlled-origin control, expired/wrong-host/self-signed TLS rejection, private redirect revalidation, proxy response limit, proxy timeout and caller abort bounds.
- Test fixtures return only fixed synthetic text, one fixed redirect, a bounded 1,000,001-byte body, or a bounded 12-second delay. They do not accept arbitrary fetch targets or user content. They exist only on the run-specific temporary Worker.
- Sample the existing private path six times, at least 30 seconds apart. Passing samples cover at least 150 seconds, not 24-hour reliability, background/reboot recovery or all mobile networks.
- Run synthetic deletion/ownership tests against local in-memory SQLite using repository migrations, including sessions, memory settings, GitHub OAuth state and encrypted-token placeholders. No real user data is used.
- Read only nine closed-set foreign-key PRAGMA statements from production D1. No production user rows, exports, chat content or writes are requested. Schema inspection is not proof of live account deletion or backup erasure.
- Replace bare exception-object logs with fixed error-name metadata. Provider exception messages, stacks, custom properties and custom error names are excluded by the helper and regression tests.
- Retain finally cleanup and add an always-run cleanup check restricted to the exact run/attempt-specific probe name. A forcibly lost runner is still an operational boundary; confirm removal from the run evidence.

## Current local evidence

Node regression suite: 483 passed, one opt-in live DNS fixture skipped. Four synthetic schema/deletion tests passed. Probe Worker Wrangler dry-run passed. These are local/source facts; hosted results must be linked separately after execution.

The opt-in external DNS fixture is not silently counted as passed. Existing isolated socket/DNS tests cover mixed answers, CNAME loops, rebinding behavior, TLS identity failures, byte/time limits and cancellation. They are not relabeled as hosted DNS-fixture evidence.

## Privacy data-flow findings

| Item | Verified boundary | Remaining decision/evidence |
| --- | --- | --- |
| Original signed-in messages | D1 stores original message content, which can contain complete URLs and query strings | No claim that all URL secrets are redacted at rest; explicit retention and disclosure needed |
| Stored citation metadata | Query/fragment and credentials are removed from newly persisted metadata | Historical rows and URLs inside message text are separate; no historical content was queried or migrated |
| Conversation deletion | Scoped application routes and local cascade tests preserve other users | Production FK metadata audit passed on nine tables; no live deletion was performed |
| Account-linked sessions, keys, GitHub tokens, memory | Nine schema relationships and local synthetic user-row deletion are checked | SQL cascade is not an account-erasure API, provider revocation or backup deletion proof |
| Explicit memory | Separate opt-in and separate deletion | Conversation deletion does not erase independent memories |
| Daily usage | Source attempts cleanup of counters older than two days on first successful daily global charge | Opportunistic cleanup is not a guaranteed TTL or immediate per-account erasure |
| Application errors | New helper logs only allowlisted error-name metadata | Previously written logs are not retroactively erased; provider/log retention remains unverified |
| Model telemetry | Structured operational fields rather than prompts/page bodies in reviewed emit path | Inventory of provider-side access, retention and correlation data still required |
| Termux proxy | Reviewed handler does not persist destination/page bodies | Phone access, local logs, backups, OS lifecycle and incident owner need operational review |
| Exports | User-controlled downloaded/printed copies exist outside server deletion | Cannot revoke exported copies through a server-side delete |

## Release gates that this implementation cannot self-attest

1. Hosted controlled DNS mixed-answer/CNAME/rebinding fixture coverage and separate origin-family coverage remain open unless actual evidence is supplied.
2. Long-term/background/disconnect/reboot stability is not established by six samples.
3. Provider processing locations, backup/recovery windows, actual log retention/access and user-facing retention policy must be confirmed. No retention period or jurisdiction is invented here.
4. A named independent reviewer other than the implementer must assess the evidence and record a decision. Codex engineering review does not satisfy that independence requirement.

The owner already authorized activation conditional on all required checks passing. A successful bounded test workflow does not waive these unresolved gates. Keep Issue #156 open and the production reader OFF.

## Executed evidence update

- [PR #219](https://github.com/muhriskiawan23/ai-command-center/pull/219) passed all CI, including E2E, container validation and synthetic privacy cascades. The error-log changes were deployed with the reader OFF; the production deep health check returned database=true and aiBinding=true.
- [Production audit run 43314988373](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43314988373) reported `d1_schema_cascade_contract=PASS; tables=9; production_user_rows_read=0; writes=0`. This verifies declared relationships, not production deletion, backups or revocation.
- The same run reported the Tunnel `down`. The private-path probe failed before the extended hosted suite and before repeated stability sampling. **The eight extended hosted checks and the six samples are NOT reported as passed.** Temporary Worker deletion and the always-run cleanup confirmation both succeeded.
- [DNS-only audit run 43314177972, attempt 2](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43314177972/attempts/2), source `20898ea7208c34f12b4c63032756823df31a12fc`, passed with `publicAccepted=1` and `privateRejected=1`. A/AAAA public control queries answered. Transient resolver errors were retained and rejected before transport. The first attempt lacked public evidence and remains recorded as failed; it was not rewritten as passed.
- DNS transport in that test is deliberately stubbed: no HTTP/TCP connection to either fixture destination is made. It is authoritative DNS/selection/denial evidence from the runner, combined with separately recorded real socket and Termux private-path proofs; it is not a live Termux DNS-rebinding socket experiment.
- Workspace external DNS controls themselves returned ECONNREFUSED, so that local attempt yielded no DNS evidence. Local Wrangler dev was also attempted and blocked by the environment's `uv_interface_addresses` restriction; only dry-run build success is claimed locally.
- `.egress-token`, the local key directory, and generated probe configs are now ignored by Git. This prevents ordinary future adds after pulling the ignore rules; it does not attest past secret history or change credentials.

## Concrete remaining operator/reviewer work

1. Make the Termux connector available while the phone is backgrounded, then rerun the existing hosted audit to collect the eight negative checks and six stability samples. Android background/battery configuration cannot be changed by the connected GitHub tools. Disabling restrictions is a mitigation to test, not a reliability guarantee.
2. Record an independent person's review decision against the findings and actual runtime results. The owner can review the packet, but no decision or signature is inferred from a request to implement tests.
3. Confirm provider/log/backup retention and access, processing locations, and the user-facing history/deletion policy. The documented D1 Time Travel limits are 7 days (Free) or 30 days (Paid); the actual account plan and recovery access were not verified. Live-row deletion must not be described as immediate backup erasure.

References: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 SQL/foreign-key semantics](https://developers.cloudflare.com/d1/sql-api/sql-statements/), [badssl certificate fixtures](https://badssl.com/).

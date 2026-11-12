# URL Reader engineering security/privacy review — 13 November 2026

Engineering reviewer: Codex. Independent reviewer: **unassigned**.
Decision: **NO-GO pending runtime evidence, unresolved controls and independent review**.
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

Node regression suite: 482 passed, one opt-in live DNS fixture skipped. Four synthetic schema/deletion tests passed. Probe Worker Wrangler dry-run passed. These are local/source facts; hosted results must be linked separately after execution.

The opt-in external DNS fixture is not silently counted as passed. Existing isolated socket/DNS tests cover mixed answers, CNAME loops, rebinding behavior, TLS identity failures, byte/time limits and cancellation. They are not relabeled as hosted DNS-fixture evidence.

## Privacy data-flow findings

| Item | Verified boundary | Remaining decision/evidence |
| --- | --- | --- |
| Original signed-in messages | D1 stores original message content, which can contain complete URLs and query strings | No claim that all URL secrets are redacted at rest; explicit retention and disclosure needed |
| Stored citation metadata | Query/fragment and credentials are removed from newly persisted metadata | Historical rows and URLs inside message text are separate; no historical content was queried or migrated |
| Conversation deletion | Scoped application routes and local cascade tests preserve other users | Production FK metadata audit pending; no live deletion was performed |
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

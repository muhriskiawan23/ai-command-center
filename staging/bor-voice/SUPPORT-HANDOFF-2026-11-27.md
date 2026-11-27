# GPT-Live Voice API support escalation — 2026-11-27

Do not conflate this API incident with existing ChatGPT deployment case 21221763. This is a prepared request, not a submitted support ticket.

## Support message

Subject: GPT-Live 1.1 WebRTC session termination and final usage unavailable after HTTP 503

Hello OpenAI API Support,

I am developing BOR AI Voice using GPT-Live 1.1. During staging testing on November 27, 2026 (Asia/Jakarta), a WebRTC session was interrupted when the Android device lost connectivity. Our server-side attempts to attach to the existing session failed, including a recovery attempt returning HTTP 503. We have not received a valid session.closed event with final usage. Our ledger therefore preserves the original reservation and denies further paid sessions.

The staging status reports pilot_session_unconfirmed, attach_failed, and attach_http_503. The API dashboard for November 21–27 shows approximately USD 0.06 in GPT-Live charges and USD 0.07 overall for the selected project. These are rounded aggregates and we do not treat them as session-specific settlement evidence.

Could you please provide or explain how to obtain:
1. Authoritative termination status, termination timestamp, and final billable usage/cost for the affected session, including any continuing exposure.
2. Whether HTTP 503 on sideband attach can occur for an already closed session, and the supported recovery or lookup mechanism when session.closed was missed.
3. The provider-enforced maximum billable duration for GPT-Live 1.1 sessions using WebRTC and primary WebSocket, whether a shorter hard session limit can be configured, and what happens to billing if the transport disconnects without a graceful close.
4. Whether a primary WebSocket handshake before session.start can incur charges.

I can provide the project and session identifiers and timestamps through an authenticated support channel if needed. No API keys or credentials will be shared. We need this information to safely resume a bounded production pilot without duplicate charges.

Thank you.

## Acceptance checklist (after release gates pass)
- Server-authenticated owner-only staging; provider exposure verified against the approved budget; legacy record preserved; kill switch and rollback ready.
- Android: grant microphone permission, speak normally, hear a model response; interrupt and verify response adapts; both directions remain active.
- Disconnect network once, restore connection; verify microphone stops, no phantom reconnect or duplicate paid allocation, and status reflects server ledger.
- Stop session; verify matching provider session.closed and final usage persisted; check charge and remaining reservation. Do not rearm if finalization is missing.
- Validate mobile and desktop; verify guest and unauthorized origins cannot open a session; verify normal chat/login unaffected.
- Release limited pilot only after actual observations and documented rollback. A successful mock is not live audio acceptance.

No new paid sessions, API keys, billing changes, deployment, or ledger reset are authorized by this note.

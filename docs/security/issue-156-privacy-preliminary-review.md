# Issue #156 — preliminary privacy and retention code review

Date: 2026-11-11. Scope: static repository inspection only; **NOT an independent privacy signoff** and **NOT a hosted deployment audit**.

## Confirmed from source

- `src/index.js` reads authenticated conversation history from D1 `messages`, scoped by `conversation_id` and `user_id`. `migrations/0001_auth_and_chat.sql` defines users, sessions, conversations and messages; messages store full `content` and `created_at`.
- `migrations/0008_message_link_sources.sql` adds `messages.links_json`; `src/index.js` explicitly redacts query strings and fragments from persisted *source link metadata*, but the original user message is preserved and may itself contain full URLs and query strings. **Do not claim all URLs are redacted at rest.**
- Authenticated `DELETE /api/conversations` and `DELETE /api/conversations/:id` delete conversation rows scoped by user; the schema declares `messages.conversation_id REFERENCES conversations(id) ON DELETE CASCADE`. Verify D1 foreign-key enforcement in a real isolated database before asserting cascade deletion end-to-end.
- `src/memory.js` supports opt-in user memory with per-item and all-items deletion and heuristic sensitive-content rejection. This is distinct from conversation history and does not prove account-wide erasure.
- `src/index.js` emits structured model telemetry intended to exclude prompts/responses/user IDs, but full logging inventory and provider-side retention remain unverified.
- `src/links.js` returns a fail-closed error without an injected transport; production `src/index.js` uses `env.LINK_FETCHER || null`, marked as a test hook. Confirm no deployment injects this hook before claiming effective production behavior.

## Open risks / verification tasks

1. **Data inventory:** enumerate every D1 table containing user-linked data (sessions, messages, memories, citations, feedback, usage, API keys, GitHub connections, provider accounting) and verify per-user deletion behavior; conversation deletion is not account deletion.
2. **Retention:** establish documented periods for chat history, source-link metadata, telemetry, error logs, provider processing, backups and exports; no retention duration is established by the inspected schema.
3. **Sensitive URL exposure:** full URLs can remain inside message content even when `links_json` strips queries; assess consent, user disclosure, logging, export and deletion.
4. **Provider path:** review what page excerpts and chat history are sent to Workers AI and any configured external providers, including subprocessors and jurisdictions.
5. **Deletion proof:** test cascade behavior, user ownership isolation, memory deletion, backup lifecycle, and exports using synthetic D1 fixtures. No production data should be queried for this review.
6. **Logging proof:** audit all `console.*` and exception handling paths across Worker, GitHub/Telegram integrations and any future proxy; prevent request URLs, query strings, tokens, page bodies and prompts from reaching logs.
7. **Independent approval:** a named reviewer other than the implementer must record review date, evidence, findings, mitigations and explicit pass/fail before Gate C is closed.

## Decision

**Gate C: OPEN / NOT APPROVED.** This preliminary review identifies data flows and tests still required. Do not enable URL reader production or claim privacy compliance based on this document.

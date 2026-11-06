# BOR AI

Public AI workspace with Google sign-in, temporary guest sessions, private per-account chat history on Cloudflare D1, Workers AI inference, and a multi-agent coordinator.

## Features

- Coordinator routes straightforward requests through one model call and complex requests through a multi-agent workflow.
- Multi-agent sequence: Researcher → Analyst → Fact Checker → Writer.
- Specialist modes: Researcher, Analyst, Writer, Fact Checker, Strategist, Coder, Planner, Critic, and Summarizer.
- Explicit response quality gates for exact numbered-item requests and zero-budget promotion recommendations.
- Request validation, a 64 KB streaming request-body cap, sanitized model errors, and API method checks.
- Cloudflare chat rate limiting: 20 accepted chat requests per 60 seconds per client IP and Cloudflare location. Signed-in users are additionally limited per account, so quota cannot be multiplied by changing IP.
- Public Guest Mode: conversations exist only in page memory and disappear when the visitor leaves or reloads. Only a "guest chosen" flag is kept in `sessionStorage` (per tab) so a refresh does not return to the Welcome screen; no chat content is ever stored.
- Google sign-up/sign-in with server-verified ID tokens and secure, HttpOnly sessions.
- Signed-in users get private D1-backed conversation history with cursor-based pagination, individual chat deletion, delete-all history, persistent conversation pinning, archive/restore, and plain-text export of the currently open conversation with a privacy warning. Long exports disclose when the 500-message read limit applies.
- Conversation read, pin, archive, rename, and delete endpoints enforce account ownership on the server. History listing uses stable descending keyset pagination (pinned, updated time, ID), with every page scoped to the authenticated account. Signed-in chat retries reuse an account-scoped idempotency key so a lost HTTP response does not duplicate a successfully saved turn. Conversation export is generated in the browser from the currently loaded conversation; it does not create a public share link or send chat content to another service.
- A private daily usage summary for the current signed-in account or guest IP hash, showing used/remaining quota units and the 07:00 WIB reset time. It does not expose global usage or estimate monetary billing.
- Signed-in chat submissions carry a client request ID. If the browser loses the response after the Worker has saved the turn, retrying the same request replays the saved answer instead of generating or storing a duplicate. This requires migration `0006_chat_request_idempotency.sql`; guest chats remain memory-only and are not persisted for deduplication.
- Security headers on API and HTML responses, including a restrictive Content Security Policy compatible with the dashboard's inline assets.

- An on-demand, accessible About BOR AI dialog describing the product, current capabilities, privacy controls, and official repository.

## Architecture

- `src/index.js`: Cloudflare Worker API and orchestration.
- `public/index.html`: frontend dashboard.
- `wrangler.jsonc`: Worker, Workers AI, static assets, and rate-limit bindings.
- `tests/`: Worker API, orchestration, and frontend regression tests.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service health |
| GET | `/api/agents` | Available agent IDs and names |
| GET | `/api/usage` | Current visitor's daily quota usage and remaining units (private; no global totals) |
| POST | `/api/chat` | Run a Coordinator or selected specialist; saves only for signed-in users |
| POST | `/api/documents/pdf` | Convert one uploaded PDF into temporary Markdown context for chat (8 MB maximum) |
| POST | `/api/feedback` | Save or update helpful/not-helpful feedback for an assistant answer owned by the signed-in user |
| GET | `/api/config` | Public Google sign-in configuration |
| GET | `/api/auth/nonce` | One-time sign-in nonce |
| POST | `/api/auth/google` | Verify Google ID token and create a session |
| GET | `/api/auth/me` | Current signed-in account |
| POST | `/api/auth/logout` | End the current session |
| GET | `/api/conversations` | List the current user's active conversations (or `?archived=1` for archived chats), 100 at a time with a keyset cursor |
| GET | `/api/conversations/:id` | Read a conversation owned by the current user |
| DELETE | `/api/conversations/:id` | Delete one owned conversation |
| DELETE | `/api/conversations` | Delete all conversations owned by the current user |

Chat requests must use `Content-Type: application/json` and contain a non-empty `message`. The optional `agent` field must match one of the IDs returned by `/api/agents`.

## Local development

Requires Node.js 22+ and a Cloudflare account authenticated with Wrangler.

```bash
npm test
npm run check
npm start
```

The local Worker uses the remote Workers AI binding; AI inference can consume account quota or incur usage charges even while developing locally. Wrangler creates a local D1 database for development. Apply migrations locally with `npx wrangler d1 migrations apply bor-ai-chat --local --config wrangler.jsonc`.

## Preview build

```bash
npm run preview
```

The GitHub Actions preview workflow runs this dry-run build on pushes to the hardening branch and pull requests targeting `main`.

## Deployment

Production deployment is manual and is available from GitHub Actions using the **BOR AI production deploy** workflow (`workflow_dispatch`). It provisions or reuses the named D1 database, injects the D1 UUID into the runner's Wrangler config, applies migrations, configures Google sign-in, deploys the Worker/assets, and checks the public endpoints.

Before running the workflow, add these **repository Actions secrets**:

- `CLOUDFLARE_API_TOKEN`: token with D1 Write and Workers Scripts Write permissions for the target account.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `GOOGLE_CLIENT_ID`: Google OAuth 2.0 Client ID for a Web application. In Google Cloud Console, add `https://ai-command-center.muhriskiawan23.workers.dev` (or the chosen production custom domain) to **Authorized JavaScript origins**.

Then open **Actions → BOR AI production deploy → Run workflow** on `main`. The workflow runs tests and a dry-run build before it creates/reuses `bor-ai-chat`, applies the D1 migration, stores `GOOGLE_CLIENT_ID` as a Worker secret, deploys, and verifies health, agents, and Google configuration. The optional live chat check is off by default because it consumes Workers AI usage.

After a successful workflow, complete a real-browser sign-in, persistence, deletion, and account-isolation check. Also verify Workers AI usage limits/billing and that the `CHAT_LIMITER` binding is active. A health check does not prove live AI inference works.
Do not treat a Wrangler dry run or health check as proof that live AI inference works. A live chat invocation is a separate release check.

## Security and operational notes

- Chat generation is public and Guest Mode requires no account. Apply usage monitoring, abuse detection, and an appropriate spend ceiling before promoting the endpoint widely.
- Google ID tokens are signature-verified against Google's published signing keys; the backend also checks issuer, audience, expiry, verified email, and a one-use nonce cookie. Sessions use random opaque tokens stored as SHA-256 hashes in D1 and are issued in Secure, HttpOnly, SameSite=Lax cookies.
- Conversation queries and deletion are always scoped to the authenticated Google subject. The database uses cascading foreign keys for account-owned records.
- Guest conversations are never written to D1 or localStorage. They live only in page memory and disappear on refresh, tab close, or leaving the page.
- The configured rate limiter is a best-effort guardrail, not a strict global quota. Cloudflare applies these counters approximately per Cloudflare location. The current key is the connecting IP, so people sharing a public/mobile network may share a limit.
- Never put API keys, credentials, or other secrets into prompts or browser storage. Do not put sensitive or regulated data into a public AI service.

## Current release boundary

The repository is prepared for a controlled deployment after the checks above. No production deployment or pull-request merge is performed automatically by CI.

## Conversation memory and failure behavior

- **What the model sees.** Each request sends the most recent turns of the same conversation: at most 12 messages, 8,000 characters in total, 2,000 per message, always starting with a user turn. Older turns are dropped, not summarized.
- **Signed-in users:** the server loads the history from D1 (after verifying ownership). Any `history` sent by the client is ignored.
- **Guests:** the client sends its in-memory history. The server validates the shape (`role` is `user`/`assistant`, `content` is a string, at most 40 items) and applies the same bounds. It is treated as untrusted user text.
- **Multi-agent flow:** history is given to the Researcher and to every Writer pass; the other agents work from the Researcher's output.
- **Failed turns are never stored.** A user message and its answer are written to D1 together, only after the AI succeeds. If generation fails, nothing is saved. The UI shows the error with a "Coba lagi" button; the failed turn is excluded from later context and is gone after a reload.
- **Retry** resends the same text and does not create duplicates.


## Chat input behavior

- **Enter inserts a new line** on every device (including Shift+Enter). Nothing else sends a message: Ctrl/Cmd+Enter does not either.
- **The arrow button is the only way to send.** A message is sent once; double taps are ignored while a request is in flight.
- The textarea grows with its content up to `min(220px, 40dvh)`, then scrolls internally.

## Limits and timeouts

- Opening a conversation returns at most the newest 500 messages (`truncated: true` when older ones exist). The model still only sees the last 12 turns.
- The browser aborts a chat request after 150 seconds and shows a retry button. If the server finished after the browser gave up, the exchange may already be stored, so retrying can create a duplicate (no idempotency key yet).
- Every agent receives a fixed "platform capabilities" notice (`CAPABILITY_NOTICE` in `src/index.js`): BOR AI can read user-supplied links under restrictions and uploaded PDFs through the PDF conversion flow, but cannot browse/search autonomously, read arbitrary files or images, run code, or use other apps. Update that notice whenever a real capability is added.

See `docs/AUDIT-BOR-AI.md` for the full technical audit, severity ratings and what could not be tested.

## Daily usage limits (cost protection)

The workspace sidebar includes a **Penggunaan** panel backed by `GET /api/usage`. It reports only the current account's units or the current guest IP's daily hashed counter, the configured limit, remaining units, and the next reset (07:00 WIB). It intentionally does not expose the application-wide counter or claim a monetary cost estimate; provider billing is not available from this counter.

- Units per UTC day (resets 07:00 WIB): **guest 15** (per IP, stored only as a daily-rotating hash), **signed-in account 150**, **whole application 1,500**. A normal message costs 1 unit; a multi-agent request (several model calls) costs 3. A failed AI request gives its units back.
- Defaults can be changed without code via the Worker variables `DAILY_LIMIT_GUEST`, `DAILY_LIMIT_USER`, `DAILY_LIMIT_GLOBAL`. Optionally set the secret `USAGE_SALT` so guest IP hashes cannot be brute-forced offline.
- Counters live in the `daily_usage` table (migration `0002`, additive). **Run `bor-ai-deploy` so the migration is applied.** If the table is missing, chat keeps working but limits are disabled and the Worker logs `daily limits are DISABLED`.
- Other database errors fail closed (503, AI is not called).
- Not covered: bot protection (e.g. Cloudflare Turnstile). A distributed attacker can still exhaust the global daily budget, but not exceed it.

## Link reader

- Links typed in a message (`https://...` or `www....`, at most 3) are fetched by the Worker, converted to plain text (up to 16,000 characters per page) and given to the model inside `<web_page>` blocks as **untrusted data**. The reply includes a `links` list and the UI shows which links were read or why they failed.
- Guards (see `src/links.js`): http/https on ports 80/443 only, no credentials in the URL, no private/loopback/link-local/reserved IPs (IPv4 and IPv6, including obfuscated forms), no internal host names, never this Worker's own host; redirects are re-validated on every hop (max 3); 8 s timeout and 1 MB download cap per page.
- A message with links costs 1 extra daily unit. Page text is never stored in D1.
- Not supported by the link reader: images, pages that need JavaScript or a login (reported as failed, never guessed). PDF URLs are still not fetched by the link reader; use the PDF attachment control instead.
- `LINK_FETCHER` is a test hook (an alternative `fetch`); leave it unset in production.

## PDF reader

- Users can attach one PDF from the composer. The Worker accepts same-origin multipart uploads only, validates the `.pdf` extension and `%PDF-` signature, and enforces an 8 MB file limit.
- The Worker converts the PDF through the Cloudflare Workers AI `env.AI.toMarkdown` binding, with PDF metadata excluded from conversion output. The conversion processes pages sequentially and can produce page headings such as `### Page 1`; BOR AI uses those headings for `[PDF p. N]` citations and removes page citations that do not match extracted page markers.
- Extracted text is capped at 32,000 characters per document before being included in a chat request. Truncation and missing page markers are disclosed; page citations are not fabricated when reliable page boundaries are absent.
- PDF content is marked as untrusted data and is never treated as instructions. The original PDF and extracted text are not saved to D1. Extracted text remains in browser memory for the active chat only; after reload or switching conversations, the user must attach the PDF again to ask follow-up questions.
- Scanned/image-only PDFs, password-protected documents, complex layouts, and extraction quality are not guaranteed. The converter may fail or omit content; users should verify important figures and quotations against the original file.
- Conversion consumes one daily usage unit and is subject to the existing request rate limiter. The PDF is transmitted to Cloudflare Workers AI for conversion; do not upload sensitive documents unless comfortable with that processing.

## Model call time limits

- Every model call is bounded: 45 s per call (`AI_CALL_TIMEOUT_MS`) and 100 s for a whole multi-agent chain (`AI_TOTAL_BUDGET_MS`); a single answer may retry once. The browser gives up after 150 s, so the server always answers first.
- While a response is generating, the send control becomes a Stop button. Stopping aborts the browser request; the Worker enables `enable_request_signal` and propagates the signal to Workers AI where supported. Cancelled turns are not saved and daily usage is refunded. A provider that does not honor cancellation may continue processing/billing its in-flight call.

## Modes and communication rules

- Twelve modes (select in the composer): Coordinator (multi-agent) plus Researcher, Analyst, Writer, Fact Checker, Strategist, Coder, Planner, Critic, Summarizer, **Translator** and **Text Analyst**.
- Translator may return very short answers; every other specialist must still pass the substance gate (20+ words, 2+ lines).
- All agents receive `COMMUNICATION_NOTICE`: reply in the user's language, use the conversation context (ask one question if context is missing), notice emotional cues without diagnosing or storing anything, and respond to self-harm/violence signals with a caring message that points to emergency services (Indonesia: 112) or a trusted person. These are prompt rules, not a classifier; real-model behavior has not been evaluated.
- See `docs/FEATURE-TRIAGE.md` for the status of the founder's feature wish-list.

## Memory (opt-in)

- **Off by default**, signed-in accounts only. Nothing is inferred: only text the user explicitly asks to remember is stored, either in the Memori panel or by writing in chat `ingat bahwa ...` / `remember that ...` (single short message; a confirmation line is appended to the answer).
- Limits: 30 items, 200 characters each; at most ~1,500 characters reach the model, inside the system prompt as data (never instructions; `<` and `>` neutralised). Memory is used only while the switch is on; turning it off keeps the items, "delete all" removes them. Deleting an account row cascades.
- A conservative, heuristic filter rejects credentials, identity/payment numbers, contact details, health, religion, politics, sexual orientation/activity, ethnicity, personal finances, criminal records and being under 18. It can over-reject and can miss things; the UI warns users not to store sensitive data.
- API: `GET/DELETE /api/memory`, `POST /api/memory`, `PUT /api/memory/settings`, `DELETE /api/memory/:id` (session required, same-origin for changes).
- Tables come from migration `0003`. If it has not been applied, chat keeps working, the memory API answers `503 memory_unavailable`, and nothing is stored. **Run `bor-ai-deploy` to apply migrations.**
- Persistent conversation pinning uses the additive `0004_conversation_pinning.sql` migration.
- Archive/restore uses the additive `0005_conversation_archive.sql` migration. The production workflow applies pending migrations only when the founder explicitly runs the deploy workflow; CI uses an isolated test database.
- Answer feedback uses the additive `0007_answer_feedback.sql` migration. Signed-in users can rate a saved assistant answer as helpful/not helpful and optionally add a reason (maximum 500 characters). Feedback is attached to the exact assistant message, can be updated, and is protected by account/conversation ownership checks. Guest feedback is not persisted. The production workflow applies this migration only when the founder explicitly runs the deploy workflow; CI uses an isolated test database.
- Integrations with other platforms: see `docs/INTEGRATIONS-PLAN.md` (proposal).


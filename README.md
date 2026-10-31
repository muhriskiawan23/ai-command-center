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
- Signed-in users get private D1-backed conversation history, individual chat deletion, and delete-all history.
- Conversation read/delete endpoints enforce account ownership on the server.
- Security headers on API and HTML responses, including a restrictive Content Security Policy compatible with the dashboard's inline assets.

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
| POST | `/api/chat` | Run a Coordinator or selected specialist; saves only for signed-in users |
| GET | `/api/config` | Public Google sign-in configuration |
| GET | `/api/auth/nonce` | One-time sign-in nonce |
| POST | `/api/auth/google` | Verify Google ID token and create a session |
| GET | `/api/auth/me` | Current signed-in account |
| POST | `/api/auth/logout` | End the current session |
| GET | `/api/conversations` | List the current user's conversations |
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


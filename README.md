# AI Command Center

Public AI workspace with Google sign-in, temporary guest sessions, private per-account chat history on Cloudflare D1, Workers AI inference, and a multi-agent coordinator.

## Features

- Coordinator routes straightforward requests through one model call and complex requests through a multi-agent workflow.
- Multi-agent sequence: Researcher → Analyst → Fact Checker → Writer.
- Specialist modes: Researcher, Analyst, Writer, Fact Checker, Strategist, Coder, Planner, Critic, and Summarizer.
- Explicit response quality gates for exact numbered-item requests and zero-budget promotion recommendations.
- Request validation, a 64 KB streaming request-body cap, sanitized model errors, and API method checks.
- Cloudflare chat rate limiting: 20 accepted chat requests per 60 seconds per client IP and Cloudflare location.
- Public Guest Mode: conversations exist only in page memory and disappear when the visitor leaves or reloads.
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

Production deployment is intentionally manual:

```bash
npm run deploy
```

Before enabling public signup, complete all of the following:

1. Create a Google OAuth 2.0 Client ID for a Web application in Google Cloud Console. Add the production Worker/custom domain to **Authorized JavaScript origins**.
2. Deploy once so Wrangler can provision the D1 database declared in `wrangler.jsonc`; then apply the remote schema with `npx wrangler d1 migrations apply bor-ai-chat --remote --config wrangler.jsonc`.
3. Set the Google Client ID in the Worker environment with `npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.jsonc`. The Client ID is returned by the public `/api/config` endpoint for the Google button; it is not a private API key.
4. Verify the target Cloudflare account has Workers AI enabled, usage limits/billing understood, and the `CHAT_LIMITER` binding active.
5. Check `/api/config`, `/api/auth/me`, and `/api/health`; sign up with a test Google account; verify chat history survives reload; test single-chat and delete-all actions; verify a second account cannot read/delete the first account's chat.
6. Open the dashboard in a real browser and check layout, console, network, and mobile behavior.
7. Run a manually initiated live chat through Researcher, Analyst, Fact Checker, and Writer and review actual model output.

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

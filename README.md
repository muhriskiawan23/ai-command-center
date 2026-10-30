# AI Command Center

Personal AI workspace with a Cloudflare Worker backend, Workers AI inference, a static responsive dashboard, and a multi-agent coordinator.

## Features

- Coordinator routes straightforward requests through one model call and complex requests through a multi-agent workflow.
- Multi-agent sequence: Researcher → Analyst → Fact Checker → Writer.
- Specialist modes: Researcher, Analyst, Writer, Fact Checker, Strategist, Coder, Planner, Critic, and Summarizer.
- Explicit response quality gates for exact numbered-item requests and zero-budget promotion recommendations.
- Request validation, a 64 KB streaming request-body cap, sanitized model errors, and API method checks.
- Cloudflare chat rate limiting: 20 accepted chat requests per 60 seconds per client IP and Cloudflare location.
- Responsive single-page dashboard with browser-local conversation history.
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
| POST | `/api/chat` | Run a Coordinator or selected specialist |

Chat requests must use `Content-Type: application/json` and contain a non-empty `message`. The optional `agent` field must match one of the IDs returned by `/api/agents`.

## Local development

Requires Node.js 20+ and a Cloudflare account authenticated with Wrangler.

```bash
npm test
npm run check
npm start
```

The local Worker uses the remote Workers AI binding; AI inference can consume account quota or incur usage charges even while developing locally. The dashboard's static assets and rate-limit simulation run in the local Worker environment.

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

Before deploying, verify all of the following:

1. GitHub Actions tests and preview build are green for the exact commit being released.
2. The target Cloudflare account has Workers AI enabled and the account's usage limits/billing are understood.
3. The `CHAT_LIMITER` binding in `wrangler.jsonc` is present in the deployment configuration.
4. The deployed `/api/health` and `/api/agents` endpoints return the expected responses.
5. A manually initiated live chat test completes through Researcher, Analyst, Fact Checker, and Writer and returns valid formatting.
6. The dashboard has been opened in a real browser and checked for layout, console, network, and mobile issues.

Do not treat a Wrangler dry run or health check as proof that live AI inference works. A live chat invocation is a separate release check.

## Security and operational notes

- Chat endpoints are public unless the Worker is placed behind an access-control layer. This repository does not currently implement user accounts or authentication.
- The configured rate limiter is a best-effort guardrail, not a strict global quota. Cloudflare applies these counters approximately per Cloudflare location. The current key is the connecting IP, so people sharing a public/mobile network may share a limit.
- Browser conversation history is stored only in the visitor's local browser storage; it is not synced to a server.
- Never put API keys, credentials, or other secrets into prompts or browser storage.
- Do not use this public endpoint for sensitive or confidential data without adding an access-control layer.

## Current release boundary

The repository is prepared for a controlled deployment after the checks above. No production deployment or pull-request merge is performed automatically by CI.

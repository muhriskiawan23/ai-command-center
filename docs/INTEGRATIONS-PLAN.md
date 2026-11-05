# Integrations plan (proposal for founder approval — nothing here is implemented yet)

Goal stated by the founder: BOR AI should integrate with many platforms and websites.

## What "integrate with everything" really requires
Code alone cannot do it. Every integration needs, outside the code:
1. An account/credential **owned by the founder** (OAuth app, bot token, API key). These are stored as Cloudflare secrets, never in chat or in the repository.
2. **Per-user authorization** to access that user's data (OAuth consent), revocable at any time.
3. A **security review and tests** for that connector.
4. Sometimes **provider approval** (e.g. Google verification for sensitive scopes, Meta business verification) and **cost**.
So integrations are delivered one connector at a time, in the order below.

## Connector framework (built once, reused by every connector)
- `connections` table: user, provider, granted scopes, token stored **encrypted** (AES-GCM, key in a Worker secret); tokens are never sent to the browser, never put in prompts, never logged.
- Each connector declares typed tools, each marked **read** or **write**.
- Flow: the model proposes a tool call → the server validates it against the schema, the user's grants and rate limits → executes → returns the result to the model as **untrusted data** (same framing as `<web_page>`).
- **Write actions always need an explicit user confirmation** showing exactly what will happen (preview). No autonomous writes in v1.
- Audit log visible to the user (what, when, which connector); one-click revoke.
- Tool results and web content can never trigger a write on their own (prompt-injection defence).
- Model requirement: dependable tool/function calling. Whether the current model is good enough is **not verified** and may require a stronger (paid) model — a founder decision.

## Proposed order
| # | Integration | Needs from the founder | Risk | Notes |
|---|---|---|---|---|
| 1 | **BOR AI inside other websites** (embeddable widget + public API) | Decide pricing/quotas | Medium (abuse, cost) | API key per site, origin allow-list, per-key daily quota, no third-party approval needed |
| 2 | **Telegram bot** (chat with BOR AI inside Telegram) | Create bot via BotFather, store token as secret | Low | Webhook, per-chat identity mapping, same daily limits |
| 3 | **GitHub (read-only)**: summarize issues/PRs/repos | Register a GitHub App | Low | Read scopes only |
| 4 | **Google Calendar (read-only)** | Google OAuth app + verification for the sensitive scope | Medium | Until verified, limited to test users |
| 5 | Slack / Discord / Notion | App registration per platform | Medium | One at a time |
| 6 | WhatsApp Business | Meta business verification, paid conversations | Medium | Approval takes time |
| 7 | Gmail / Drive | Google restricted scopes need an external security assessment | High | Late; costly |
| 8 | **Browser automation** ("click buttons, fill forms") | Strong model + Cloudflare Browser Rendering | **Highest** | Credentials, CAPTCHAs/ToS, injection; always with confirmation, never store passwords |

A generic tool protocol (MCP) can reduce per-tool code, but every server still needs its own authorization.

## Decisions requested
1. Which one or two integrations first (recommendation: #1 and #2, they need no third-party approval).
2. Who creates the provider accounts/keys (stored as Cloudflare secrets only).
3. Whether to pay for a stronger model before building tool-calling.
4. Approval of the confirmation-for-writes and audit-log rules above.

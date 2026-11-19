# BOR AI plugin and integrations roadmap

The founder approved the direction to build a useful plugin catalog for common services, with per-user authorization and explicit approval before any write action. This roadmap does not mean every provider is already connected or that BOR AI has approval to use provider data before the user connects it.

## What "integrate with everything" really requires
Code alone cannot do it. Every integration needs, outside the code:
1. An account/credential **owned by the founder** (OAuth app, bot token, API key). These are stored as Cloudflare secrets, never in chat or in the repository.
2. **Per-user authorization** to access that user's data (OAuth consent), revocable at any time.
3. A **security review and tests** for that connector.
4. Sometimes **provider approval** (e.g. Google verification for sensitive scopes, Meta business verification) and **cost**.
Integrations are delivered one connector at a time. The catalog now shows Google Drive, Gmail, Calendar, Slack, and Notion as coming soon until their OAuth paths and actions are implemented.

## Connector framework (built once, reused by every connector)
- `connections` table: user, provider, granted scopes, token stored **encrypted** (AES-GCM, key in a Worker secret); tokens are never sent to the browser, never put in prompts, never logged.
- Each connector declares typed tools, each marked **read** or **write**.
- Flow: the model proposes a tool call → the server validates it against the schema, the user's grants and rate limits → executes → returns the result to the model as **untrusted data** (same framing as `<web_page>`).
- **Write actions always need an explicit user confirmation** showing exactly what will happen (preview). No autonomous writes in v1.
- Audit log visible to the user (what, when, which connector); one-click revoke.
- Tool results and web content can never trigger a write on their own (prompt-injection defence).
- Model requirement: dependable tool/function calling. Whether the current model is good enough is **not verified** and may require a stronger (paid) model — a founder decision.

## Proposed order
| # | Integration | Needs before activation | Risk | Notes |
|---|---|---|---|---|
| 1 | **GitHub (read-only in chat)**: list authorized repos, review open issues, read text files | Enable the feature flag after a staging check; current OAuth connection already exists | Low | No writes. Model tool calling is beta; user-scoped repository checks are required. |
| 2 | **Google Drive / Docs (read-only)**: find and summarize approved files | Google OAuth client, least-privilege scopes, user consent, verification as required | Medium | Start read-only; defer document writes. |
| 3 | **Gmail (read-only)**: search and summarize selected messages | Google OAuth client, sensitive/restricted scope review, security assessment if required | High | Email sending is out of scope initially. Drafts remain in BOR AI until an explicit confirmed send feature exists. |
| 4 | **Google Calendar**: read events, prepare changes | Google OAuth client, least-privilege scopes and user consent | Medium | Read first; create/update/delete actions require preview and confirmation. |
| 5 | **Slack**: search channel messages and prepare replies | Slack app credentials, workspace installation and user/workspace consent | Medium | Start with authorized read access. No autonomous message posting. |
| 6 | **Notion**: search and summarize shared pages | Notion integration credentials and per-workspace page grants | Medium | Start read-only. No edits or publishing. |
| 7 | Discord / Microsoft Teams / project tools | Provider app registration and user/workspace consent | Medium | Prioritize from customer requests after the first wave. |
| 8 | WhatsApp Business and browser automation | Business verification, usage cost review, security assessment | High | Later phase. Never store website passwords; writes always require confirmation. |

A generic tool protocol (MCP) can reduce per-tool code, but every server still needs its own authorization.

## Current owner decisions
- Approved: build the BOR AI catalog and connector system for commonly used services.
- Approved: the founder may change package pricing if required to keep the product sustainable.
- Not yet supplied: Google, Slack, and Notion OAuth app credentials. These must be created by the founder or within BOR AI-owned provider accounts and stored as Cloudflare secrets.
- Not approved by this roadmap alone: new open-ended paid provider usage. Each connector needs an explicit cost cap before production activation.
- Fixed v1 rule: all write actions require a preview and explicit user confirmation; reads stay scoped to each user's grants and can be revoked.

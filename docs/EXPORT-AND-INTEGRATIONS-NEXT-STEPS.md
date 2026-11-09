# BOR AI — Export and integration implementation brief

This document turns the next planned work into small implementation slices. It is a design/acceptance brief, not a claim that the features below are already shipped. The first implementation should stay client-side and read-only; external integrations should be delivered one connector at a time.

## 1. Answer export and conversion

### Current baseline

The web client already has per-message actions for copying a response and downloading it as `.txt` or `.md`. This brief extends those actions without changing chat history or sending content to a third party.

### Checklist conversion

**User flow**
- Add a `Checklist` action to assistant messages.
- Convert recognizable Markdown list items (`-`, `*`, `+`, `1.`) into `- [ ]` items.
- Keep headings, paragraphs, code blocks, and their order; do not silently discard text.
- If no list items are recognized, show a clear notice and do not download an empty checklist.
- Offer the result as a `.md` download and copy action.

**Acceptance criteria**
- Conversion is deterministic and runs locally in the browser; it makes no AI call and uses no extra quota.
- Existing text and Markdown export remain available.
- HTML-looking response text is treated as plain text in the exported file.
- Tests cover numbered lists, bullet lists, headings/code preservation, empty input, and responses with no list items.
- Mobile controls remain reachable and keyboard accessible.

### Email draft conversion

**User flow**
- Add a `Email draft` action to assistant messages.
- Open a small dialog with recipient (optional), subject, and body fields.
- Pre-fill the body from the selected answer; allow the user to edit before copying or downloading as `.eml`/`.txt`.
- Never send the email or connect to a mail provider in this phase.
- Clearly label the output as a draft that the user must review.

**Acceptance criteria**
- No mail API, OAuth scope, or external network call is introduced.
- The draft is editable before export; recipient and subject are not invented as facts.
- Generated MIME headers are safely encoded if `.eml` export is supported; otherwise ship plain-text download first.
- Tests cover blank fields, Unicode, newline normalization, and content escaping.
- The dialog supports Escape/close, focus management, and screen-reader labels.

### PDF

Do not add a PDF dependency yet. First validate print styles with a print-friendly view and browser `window.print()`. A downloaded PDF library can be considered only if the print flow does not meet the user need and bundle/security/cost impact is reviewed.

## 2. Integration order and security checklist

Build and review one connector before starting the next. The existing `docs/INTEGRATIONS-PLAN.md` describes the shared connector framework and the requirement for consent, revocation, auditability, and confirmation before writes.

### Telegram bot — proposed first external connector

**Prerequisites / founder decisions**
- Create and own the bot through BotFather.
- Choose whether Telegram identities are guest-only or explicitly linked to an existing BOR AI account. Do not silently link identities.
- Configure bot token and a separate webhook secret as Cloudflare Worker secrets; never commit them or paste them into prompts.
- Set a per-chat and global usage/cost cap, plus an abuse-report and disable procedure.

**Implementation and security gates**
- Validate Telegram webhook authenticity using the configured secret-token header and reject missing/invalid values.
- Accept only supported message types and impose strict input/output size limits.
- Map Telegram user/chat identifiers to an explicit BOR AI identity with a documented privacy policy and deletion/revoke behavior.
- Apply the same daily usage protections as the web app; avoid allowing channel switching to multiply quotas.
- Treat inbound messages and fetched Telegram content as untrusted input. Never let prompt content trigger account linking or privileged actions.
- Do not implement write-capable tools or automatic outbound messages beyond the user's direct bot interaction in the first version.
- Add mocked webhook tests for valid/invalid secret, duplicate update handling, payload limits, quota enforcement, failures, and privacy boundaries.
- Run a private test bot before any public release; confirm provider rules and operating costs.

### GitHub integration — read-only, after Telegram foundation is reviewed

**Prerequisites / founder decisions**
- Register a GitHub App owned by the project and decide whether the first release supports public repositories only or user-authorized private repositories too.
- For private repositories, require explicit installation/authorization and document exactly which repositories are accessible.
- Use the minimum read-only repository permissions needed for the selected feature; do not request contents access if only issue/PR metadata is needed.

**Implementation and security gates**
- Keep installation tokens server-side, short-lived, and out of browser responses, prompts, and logs.
- Validate repository owner/name and resource IDs; enforce per-user installation/repository authorization on every request.
- Bound page size, response size, request frequency, and per-user usage.
- Treat issue, PR, comment, and repository text as untrusted data and mark it clearly for the model; it must not authorize tools or writes.
- Return links and source metadata so summaries can be checked against the original GitHub material.
- Keep the integration read-only: no commenting, merging, labeling, editing, or creating issues/PRs.
- Add tests for authorization boundaries, revoked installations, pagination/size limits, rate limits, provider errors, and prompt-injection-like content.
- Provide a visible disconnect/revoke path and an audit record of access without recording secrets or unnecessary content.

## 3. Suggested delivery sequence

1. Add and test the local checklist conversion; verify it in the browser on mobile and desktop.
2. Add the editable email-draft dialog and plain-text export; keep sending out of scope.
3. Review the existing export code and regression tests; fix any issues before production deployment.
4. Approve Telegram account-linking policy, quota policy, bot ownership, and secret setup; implement as a separate reviewable change.
5. Pilot Telegram privately and review costs, abuse handling, and privacy behavior.
6. Decide GitHub App scope and public/private repository policy; implement read-only access after the Telegram pilot.

## 4. Release boundary

These features must not be described as available until code, automated tests, browser checks, and an appropriate deployment have completed. A successful preview build is not proof of a live provider integration. High-risk features (browser automation, Gmail/Drive, writes, autonomous actions, and image input) remain out of scope for this brief.

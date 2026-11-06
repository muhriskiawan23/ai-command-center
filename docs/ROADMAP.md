# BOR AI roadmap

This roadmap reflects the current product direction for BOR AI as documented in the repository and the founder's planning notes. It is deliberately ordered from lowest risk to highest risk. The goal is to ship useful improvements in small, testable steps instead of stacking feature work without production stability.

## Phase 0 — Stabilize the core product

Priority: highest.

Goals:
- Keep the chat core reliable under normal traffic and failure conditions.
- Harden failure handling, quotas, auth, persistence, and user-visible error states.
- Keep automated tests meaningful for real regressions.

Scope:
- Continue validating the daily usage refund fix and similar edge cases.
- Ensure retry and timeout behavior is consistent for both single-agent and multi-agent flows.
- Keep D1 and Worker failures fail-safe: no silent charge loss, no unsafe partial writes.
- Audit release gates before any new public-facing feature is enabled.

Definition of done:
- No silent quota loss on partial DB failures.
- Clear status for auth/session failures, AI timeouts, and D1 unavailability.
- A stable regression suite for chat, auth, limits, and persistence.

## Phase 1 — Safe integrations

Priority: next.

Target features:
- BOR AI widget / embeddable public API
- Telegram bot
- GitHub read-only integration

Rules:
- One connector at a time.
- Minimal permissions only.
- User consent and explicit scope approval.
- Audit logs and one-click revoke.
- No autonomous write actions without explicit confirmation.

Why this comes next:
- These integrations have the best value-to-risk ratio and match the project plan in `docs/INTEGRATIONS-PLAN.md`.
- They can be delivered without broad platform approval in the first wave.

## Phase 2 — Search/news and curated knowledge

Priority: next after the safe integrations.

Target features:
- Search/news data source integration
- Curated document retrieval
- Source attribution and citation display
- Guardrails for stale or low-trust external content

Rules:
- Show source provenance to the user.
- Do not claim fresh live browsing unless the external data source is actually active.
- Respect privacy and rate limits.
- Keep the model grounded in retrieved content rather than guessing.

Why this matters:
- BOR AI is currently text-first. Search/news and curated retrieval improve factual grounding without expanding into full autonomous browser tools.

## Phase 3 — Better memory and explicit preferences

Priority: next.

Target features:
- Better memory UX and management
- Explicit user preference profiles
- A managed preference layer separate from raw memory
- User-visible controls for enable/disable, delete, and export

Rules:
- Memory remains opt-in and explicit.
- Never infer or silently profile sensitive information.
- Prefer clear user controls over hidden behavioral learning.

## Phase 4 — Export and conversion tools

Priority: useful but not foundational.

Target features:
- Markdown export
- Checklist generation
- Draft email creation
- PDF export or print-friendly output

Rules:
- Export should remain a transformation tool, not a writing or sending agent.
- Email drafts must require explicit user review before sending.
- The platform should disclose when it is generating an output from a prompt rather than from a verified source.

## Phase 5 — Higher-risk workflow features

Priority: later.

Target features:
- Browser automation
- Gmail and Drive access
- WhatsApp / Slack / Notion integrations
- Vision and image input
- Autonomous tool execution flows

Hard requirements before starting:
- Explicit user confirmation for writes
- Provider approval and security review where required
- Strong model/tool-calling reliability
- Cost controls and per-user permission boundaries
- Clear rollback and audit trails

These must not be tackled until the core system and lower-risk integrations are stable and well-tested.

## Team and execution principles

- Build small, testable slices.
- Prefer one concrete feature with evidence and tests over a large roadmap with no proof.
- Every external integration must have a documented permission and revoke path.
- Every new feature must answer: what problem does it solve, who benefits, and what is the cost and privacy footprint?

## Immediate next milestone

The next concrete milestone in this repository should be:
- complete and test the core stabilization work,
- then build the first safe integration package (widget/API, Telegram, or GitHub read-only),
- then move to news/search and curated retrieval.

The roadmap is intentionally conservative so that BOR AI grows into a trustworthy product rather than a feature-rich but unstable system.

# Issue #156 — privacy and operations audit register (engineering review)

Date: 2026-11-12. Scope: repository schema, source-level documentation, read-only Cloudflare audit contract, and Railway deployment metadata. **This is not an independent privacy signoff, a live D1 audit, or authorization to activate URL Reader.**

## Data inventory and verified code facts

| Data | Source / deletion boundary | Risk / remaining evidence |
| --- | --- | --- |
| Users and sessions | `migrations/0001_auth_and_chat.sql`; sessions reference users `ON DELETE CASCADE` | Session expiry exists; enforcement and account deletion endpoint require live/synthetic validation |
| Conversations and messages | `migrations/0001_auth_and_chat.sql`; messages contain full `content`, cascade with conversation/user | Original chat text may contain full URLs, query strings, secrets; no automatic retention period established |
| Source citations | `migrations/0008_message_link_sources.sql`, `src/index.js` | Newly stored link metadata strips query/fragment; historical rows and URLs inside original messages are **not** redacted |
| Explicit memory | `migrations/0003_user_memory.sql`, `src/memory.js` | Opt-in, separate deletion; deleting one conversation does not remove independent memories |
| Feedback | `migrations/0007_answer_feedback.sql` | Cascades on user, conversation and message; verify with disposable D1 fixture |
| Public API keys | `migrations/0009_public_api_keys.sql` | Stores hashes, origins, limits, revocation timestamp; verify scope, expiry, rotation and account deletion |
| GitHub OAuth connections | `migrations/0010_github_connections.sql` | Stores encrypted access/refresh tokens; verify key custody, revocation, deletion and encryption key rotation |
| Provider usage counters | `migrations/0011_search_provider_usage.sql` | Aggregate counters with provider/day, no per-user query; document counter retention |
| User exports | `public/app.js` export and print helpers | Downloaded/printed copies cannot be remotely deleted |
| Hosted proxy | `tools/egress-proxy/pinned-transport.js` | Source-level in-memory handling; hosting-provider logs, network traces and backups not audited |

## Retention and deletion: unresolved controls

1. Define explicit retention periods for chat, memory, citations, sessions, API key metadata, GitHub OAuth state, feedback, telemetry, provider logs, GitHub Actions artifacts and Railway request/network/DNS logs. **No default period is asserted here.**
2. Verify per-user and per-conversation deletion using disposable synthetic D1 with foreign keys enabled. Distinguish deletion of live rows from backup/restore retention, provider-side copies, browser downloads and exported files.
3. Inventory D1 backup/restore and recovery retention from the actual Cloudflare account; obtain evidence of deletion lifecycle and recovery access. Do not query production user content.
4. Verify provider subprocessors and data residency for Cloudflare Workers/D1/AI, Railway region, external AI/search providers and GitHub Actions. Railway deployment metadata currently shows region `iad`; region alone does not establish legal jurisdiction or privacy approval.

## Secrets and access: unresolved controls

- Keep Cloudflare deployment token separate from `CLOUDFLARE_AUDIT_API_TOKEN` read-only scope. Confirm exact least-privilege policies, authorized maintainers, secret access audit, and rotation dates without revealing values.
- Confirm `EGRESS_PROXY_TOKEN` exists in Railway, but do not copy it into logs, issue comments, CI outputs or chat. Positive hosted proof requires a controlled secret handoff and explicit Gate A/C decisions.
- Review GitHub OAuth token encryption key custody, rotation and incident revocation; API key hashes and per-origin restrictions; session invalidation; GitHub branch protection and deploy approvals.
- Do not automatically rotate production secrets without a tested rollback and owner-approved maintenance window.

## Cost and reliability: decision pending

- Document Railway service billing plan, resource usage, outbound traffic and monthly spending ceiling. No zero-cost claim is made from a deployment SUCCESS status.
- Document Cloudflare Workers/D1/AI, Gateway/VPC, external search/model costs, alert thresholds, rate limiting and quota exhaustion.
- Confirm egress service is not a public unauthenticated open proxy; plan outage behavior as **fail closed**, never direct Worker fetch fallback.

## Incident-response and operational runbook (proposal, not signoff)

1. Detect: monitor authorization failures, unexpected egress destinations, DNS/TLS rejection, proxy error rates and cost anomalies without logging user URLs or bodies.
2. Contain: keep URL Reader OFF, revoke/rotate affected credentials with rollback, disable affected bindings or service, preserve sanitized evidence.
3. Assess: identify exposure window, affected data categories, providers, backup copies and applicable notification obligations.
4. Recover: redeploy verified SHA, retest fail-closed transport and deletion/access controls, independently review before enabling.
5. Record: incident owner, escalation contacts, time-to-acknowledge targets and jurisdiction-specific reporting decisions.

## Gate decisions

- **Gate A (infrastructure/operations): OPEN.** Owner must approve provider, region/jurisdiction, monthly ceiling, private network/authentication, rotation, incident owner and rollback.
- **Gate B (hosted security): OPEN.** CI and synthetic local tests do not prove observed socket peer or live TLS identity.
- **Gate C (privacy): OPEN.** Requires named reviewer **other than implementer**, date, evidence, findings and explicit approval; this document is engineering preparation only.
- **Gate D (production activation): OPEN.** Requires explicit owner approval after A–C. Keep production URL Reader OFF and Issue #156 OPEN.

Reference: `docs/security/issue-156-production-release-gates.md`, `docs/security/issue-156-review-evidence.md`, `docs/security/issue-156-privacy-preliminary-review.md`.

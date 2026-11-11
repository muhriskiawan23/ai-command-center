# Issue #156 — production URL reader release gate

Status: **BLOCKED — no production activation authorized**. Updated 2026-11-11.

This is a decision and evidence checklist, not approval to provision infrastructure or turn on the reader.

## Existing verified evidence

- Read-only Cloudflare audit [run 43007188447](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43007188447) succeeded **only for configured scope**; cloud on-ramps remain **unverified/out of scope**.
- [PR #183](https://github.com/muhriskiawan23/ai-command-center/pull/183) added an isolated socket peer-IP mismatch regression. Container validation [run 43009750420](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43009750420) passed 38/38. This is **not** hosted origin peer-IP or TLS evidence.
- `src/links.js` fails closed when no explicitly injected transport is present. `wrangler.jsonc` has no VPC Service/proxy binding.

## Gate A — owner-approved infrastructure decision (OPEN)

Record owner approval, operator/provider, deployment region and data jurisdiction, network topology, private ingress, authentication and secret rotation, outbound firewall policy, operating cost ceiling, incident response owner, failure handling, and rollback. No cloud/VPC deployment or secret change before approval.

## Gate B — hosted synthetic transport proof (OPEN)

Use a dedicated non-production instance and controlled test DNS/TLS fixtures. Keep request/response content synthetic. Capture a redacted run ID, commit digest, environment ID, selected vetted numeric IP and socket's observed remote IP, original hostname/SNI, certificate verification result, and fail-closed decision. Never record full URLs, query strings, credentials or page bodies in CI artifacts.

| Scenario | Required outcome |
|---|---|
| Public A/AAAA | Selected IP equals observed connected peer; content only accepted after verification |
| Mixed public/private DNS, CNAME loop, rebinding | Denied before unsafe content is accepted |
| Correct original-host TLS SNI and trusted certificate | Accepted with identity verification |
| Wrong-host, expired or untrusted certificate | Denied |
| Redirect to private/metadata address | Denied on revalidation of each hop |
| Timeout, oversized body, abort, proxy outage | Bounded failure; no direct-fetch fallback |
| Missing/invalid proxy authentication | Denied; private ingress cannot be used as open proxy |

Require reviewer to link exact hosted evidence and independently check that the observed peer was captured **at the origin socket**, not inferred from DNS or a Gateway log.

## Gate C — independent privacy and retention review (OPEN)

Reviewer must be a named person other than the implementer. Record date, evidence, findings, mitigations, and explicit pass/fail for:

- Requested URL, path, query, redirects and extracted page text through Worker, proxy, AI model, error paths, metrics, and logs.
- Chat history, citations and link metadata in D1, client storage, user exports, user deletion, backups and retention windows.
- Authentication tokens and trace IDs in logs; restricted log access, encryption, short retention and deletion procedure.
- Provider region/jurisdiction, subprocessors, data transfer, incident response and user-facing disclosure.
- Evidence that synthetic tests contain no real user content and CI artifacts redact sensitive fields.

**Do not self-attest** this review; absent a named independent signoff, this gate remains open.

## Gate D — controlled release (OPEN)

Only after A–C pass, obtain separate explicit owner authorization for production rollout. Require narrow allowlisted smoke tests, documented rollback/kill switch, alerting and rate limits, and immediate fail-closed behavior on proxy or policy failure. No automatic activation from a passing CI run.

**Current decision: NO-GO.** Keep Issue #156 open and URL reader production disabled until all gates are evidenced and approved.

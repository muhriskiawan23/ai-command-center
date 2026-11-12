# Issue #156 — production URL reader release gate

Status: **BLOCKED — URL Reader OFF; bounded private-path runtime proof PASS; full release gates OPEN**. Updated 2026-11-13.

This is a decision and evidence checklist, not approval to provision infrastructure or turn on the reader.

## Existing verified evidence

- Read-only Cloudflare audit [run 43007188447](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43007188447) succeeded **only for configured scope**; cloud on-ramps remain **unverified/out of scope**.
- [PR #183](https://github.com/muhriskiawan23/ai-command-center/pull/183) added an isolated socket peer-IP mismatch regression. Container validation [run 43009750420](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43009750420) passed 38/38. This is **not** hosted origin peer-IP or TLS evidence.
- The existing VPC Service binding and Worker secret were verified in [runtime run 43305293141, attempt 2](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43305293141/attempts/2). The deployed production switch remains `URL_READER_ENABLED=false`.
- [13 November runtime evidence](private-egress-runtime-evidence-2026-11-13.md) records the exact commit, bounded checks, successful private path and cleanup. It does not close Gate B or replace Gate C.

## Gate A — owner-approved infrastructure decision (OPEN)

The owner authorized the infrastructure setup and bounded synthetic tests in the current session. Record the outstanding operational decisions: operator/provider, deployment region and data jurisdiction, topology, private ingress, authentication and rotation, outbound firewall policy, operating cost ceiling, incident owner, failure handling and rollback. The current Termux connector is not evidence of long-term availability.

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

The owner has already authorized activation conditional on all required security checks passing. That condition is not met by the bounded run alone. After A–C pass, record the evidence and controlled rollout under that authorization. Require narrow allowlisted smoke tests, documented rollback/kill switch, alerting and rate limits, and immediate fail-closed behavior on proxy or policy failure. No automatic activation from a passing CI run.

**Current decision: NO-GO.** Keep Issue #156 open and URL reader production disabled until all gates are evidenced and approved.

# One-shot Cloudflare staging-only DO-to-D1 recovery operator — #436

**Scope**: one owner-approved D1 staging database, one run-ID Worker and one
Workflow instance, followed by explicit cleanup. This PR is NOT PR #435 and
does not make any production chat journal or backup live.

- The GitHub dispatcher is tied to an **exact, specially titled one-time
  main push** that introduces its filename; no cron, PR event or reusable
  general-purpose workflow dispatch is authorized.
- The workflow checks out **PR #435 head
  `b7e8b97f8fd68c4cf0e3aa8b84e2ff988146e657`**, verifies it remains
  open and unchanged, and checks four exact-head CI workflows before any
  Cloudflare mutations. All prerequisites must pass.
- Wrangler is installed before secrets are passed. The protected `production`
  GitHub environment supplies existing Cloudflare credentials, but only
  the new, run-ID-scoped `bor-ai-journal-recovery-<runId>` D1 and
  `bor-ai-chat-recovery-d1-<runId>` Worker are permitted. The production
  Worker and `bor-ai-chat` D1 UUID are explicitly denied.
- The staging Worker has `workers_dev=false`, `preview_urls=false`,
  no public routes, no schedule, no production D1 binding, and a newly
  generated private secret. An authenticated Cloudflare Workflow API call
  launches exactly one closed synthetic scenario.
- The drill confirms a committed journal event survives a deliberately
  failing D1 batch (two messages rolled back before checkpoint), followed
  by an idempotent retry, recovered two-message turn and no-op replay.
  **This is not a real D1 infrastructure outage and not full production
  disaster recovery.**
- Cleanup is attempted after success or failure. Workflow/Worker absence is
  separately checked; the newly created D1 UUID is deleted and checked for
  absence. A failure or ambiguous resource is reported rather than hidden.

**Authorized scope** was explicitly accepted by the owner in conversation.
Cloudflare resource usage may incur charges, which cannot be estimated from
this code alone. No third-party browser service or payment is needed to
execute the protected GitHub workflow.

**Do not merge PR #435** unless this one-shot Cloudflare receipt and cleanup
are verified and exact-head CI is green. Issue #382/RPO=0 remains open.

Recovery code source: https://github.com/muhriskiawan23/ai-command-center/pull/435
Official endpoints:
https://developers.cloudflare.com/api/resources/d1/subresources/database/
https://developers.cloudflare.com/api/resources/workflows/subresources/instances/

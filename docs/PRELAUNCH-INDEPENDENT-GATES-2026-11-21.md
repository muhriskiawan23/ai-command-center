# BOR AI — Independent pre-launch gates (21 November 2026)

This checklist distinguishes **offline/CI evidence**, **live account evidence**, and **external approval**. A green CI result is not a production launch approval. No automated production deploy, purchase, database mutation, or external provider call is authorized by this document.

## Verified repository baseline

| Workstream | Exact PR head inspected | GitHub Actions evidence | Current decision |
| --- | --- | --- | --- |
| First-party public-page reader | [#342](../pull/342) `93a2614107b82f5384f30c798b1eee622e2eba24` | 4/4 workflow runs completed successfully | Open, not merged; must reconcile with #343 before any release |
| Tavily / URL Reader guardrails | [#343](../pull/343) `bea713d463c05f3d468c1496bf2ebece5b096552` | 4/4 workflow runs completed successfully | Open; provider evidence and active Worker bindings remain unverified |
| Isolated browser staging | [#344](../pull/344) `e62194257874da7efcd2542e6175608bf31f2ef8` | 5/5 workflow runs completed successfully, including staging dry-run | Draft; no real browser runtime or cloud-cost proof |
| Midtrans sandbox | [#247](../pull/247) | Sandbox test evidence documented in PR; current exact-head release state must be rechecked | Draft; no production paid-plan activation |
| Secure outbound network | [#156](../issues/156) | Partial audit; hosted DNS-pinned egress unproven | Open security blocker |

These statuses describe the referenced PR commits, **not the merged `main` branch or active production configuration**.

## Independent work that does not require Tavily or Midtrans email responses

- [ ] Verify current GitHub Actions checks against the *latest head SHA* before merging any PR. If the head changes, previous successful checks are not sufficient.
- [ ] Reconcile PR #342 with #343. Both change `src/index.js` and Tavily-reading tests; review the combined safety behavior, do not blindly merge independent green checks.
- [ ] Audit `main` and actual Cloudflare Worker settings separately. At inspection, `main/wrangler.jsonc` advertises `URL_READER_ENABLED: "true"` and Tavily Extract daily limit `8`; PR #343 proposes future-deploy safe-off values. The running environment is **unknown** until read-only account verification. Avoid treating a repository config change as an active deployed change.
- [ ] Build a consolidated no-network test matrix: URL reader off, stale/failed provider, private/loopback/credential-bearing URL, redirect, query string, browser quota, and account/session isolation.
- [ ] Audit front-end claims against actual capabilities: distinguish web search results and snippets from successful full URL reading; browser actions must remain clearly unavailable.
- [ ] Verify signed-in user identity and ownership checks on any billing/shadow-credit read path. Do not merge the chat D1 and staging billing D1 databases.
- [ ] Verify error paths, 429/503 backoff handling, duplicate chat submissions, private account authorization, and D1 idempotency with local regression tests.
- [ ] Confirm Google login redirects, session cookies, CORS/CSP and redirect URI behavior **before** a future custom-domain switch; do not assume buying a domain makes these work.
- [ ] Verify application copy and localization for Indonesian and English, including unavailable-feature states and payment disclosures.
- [ ] Prepare a non-production release checklist, rollback instructions and owner signoff record. Keep deployments, paid services and database schema operations separate.

## Work that needs provider/account evidence, not necessarily an email reply

- [ ] Read-only confirmation of **actual** Cloudflare production vars, secrets' presence (never values), DNS/VPC bindings, and release SHA.
- [ ] Controlled DNS-pinned outbound connection proof and independent privacy/cost acceptance; see #156. DNS preflight alone is not proof.
- [ ] A separately provisioned staging D1 and Browser Run binding; disabled-first deployment; real browser launch and cost/lease verification; see #344. Requires owner-approved budget and credentials, not Tavily email.
- [ ] Authorize a low-budget staging URL Reader smoke only after provider redirect/SSRF/privacy/cost guarantees are evidenced; do not send sensitive URLs to third parties.
- [ ] Validate Midtrans refunds, disputes, partial reversals, operator decisions, checkout fees, FX, and invoices against real merchant obligations; no automatic credit grants outside approved sandbox.

## External blockers

- Tavily: vendor-side SSRF/redirect DNS safeguards, retention/subprocessors, failed-call billing and hard limits, or an independently verified replacement design. Search capability does not prove safe URL-reading capability.
- Midtrans: merchant activation for production payment methods, settlement/refund/dispute evidence, merchant compliance and required business documents.
- Domain purchase: deferred; use the existing Workers hostname until owner authorizes a domain and checkout.

## Release invariants

1. **No** unreviewed public URL fetch or browser action execution in production.
2. **No** production billing, paid-plan or credit grant activation without merchant and finance acceptance.
3. **No** accidental secret disclosures in repository, CI logs, API capabilities, or screenshots.
4. **No** claim that CI, mocks, isolated local D1, or fake staging bindings prove live-provider behavior.
5. **No** merge or deployment just because a checklist item is present; review, latest-head CI and owner approval still apply.

## Next engineering order

1. Review and reconcile #342/#343, protecting safe-off defaults.
2. Validate #344 policy and isolated offline tests; keep browser execution disabled.
3. Run local regression, E2E, dry-run bundle, and check exact-head statuses after each change.
4. Conduct read-only production configuration and security audits.
5. Request explicit owner approval for any spending, staging live calls, deployment, payment changes, or production migrations.

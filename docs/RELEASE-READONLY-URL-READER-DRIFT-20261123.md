# BOR AI — read-only production URL Reader release drift audit

23 Nov 2026 — live deployment audit remediation guidance. **Source-only and read-only; does not deploy.**

The last independently recorded active Cloudflare Worker readiness audit on
[run 45122878550](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45122878550)
reported the following at its execution time:

- `/api/health?deep=1` checks for D1 and AI binding passed.
- Active Cloudflare Worker `URL_READER_ENABLED` was `true`, while reviewed
  `wrangler.jsonc` on `main` is `false`.
- Active Tavily Extract daily quota was nonzero, while reviewed main is zero.
- Active image-pilot binding was `false`.
- Public `/api/plugins/capabilities` did **not** expose both expected
  `webReading` and `webActions` members, so the public safe-off contract
  could not be verified.

The last run FAILED correctly; a green unit suite does not supersede live
configuration evidence. This PR does not assume that earlier live observations
are still current.

## Safe action sequence

1. Re-run this workflow against merged `main` to read the **currently active**
   Worker version and public capability endpoint (no AI inference, database
   mutation, Tavily Extract or deployment).
2. The workflow now reports release-annotation synchronization and three
   bounded, non-secret safe-off classes **before** enforcing the safe-off gate.
   It reports public capability field presence and fixed booleans only.
3. If the active release differs from `main`, never diagnose a current
   source-code change as already deployed. Confirm the deployed commit and
   decide whether to preserve the existing Reader or shut it down, **with
   explicit owner/security approval**. The production deploy workflow has
   separate, mutually exclusive preservation/shutdown inputs, and forbids
   silent shutdown of an already-active Reader.
4. Keep the audit red if the active Reader is enabled, the active extraction
   budget is nonzero, the public contract is missing/inconsistent, or the paid
   image-pilot guard cannot be attested. Do not mark readiness green by
   weakening assertions or treating unknown as disabled.

## Scope and blockers

This PR adds no public endpoints, secrets, paid integrations, write capability,
or Cloudflare configuration changes. A read-only GitHub Actions audit consumes
normal GitHub runner minutes and Cloudflare read-only API calls.

A full production release cannot be declared safe or normal until the live
Reader state, security/privacy review, account audit and recovery issue #382
are all reconciled. A deployment/feature rollback would be a separate owner
decision, not a side effect of an audit fix.

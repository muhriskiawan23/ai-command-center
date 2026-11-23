# BOR AI - manual public core liveness at zero additional provider spend

23 November 2026. This source-only operational monitor does not deploy or change customer state.

## What a green manual run means

At the time of a manual run, from one GitHub Actions runner:
- https://app.getborai.com/ returns HTML.
- https://app.getborai.com/api/health returns ok=true and identifies BOR AI.
- https://app.getborai.com/api/agents exposes coordinator/researcher/writer.
- The original public Cloudflare Worker hostname provides the same health and agent shapes.
- https://getborai.com/ returns HTML or redirects to a BOR AI homepage.

The probe uses exactly six bounded public GETs and safely follows at most two redirects among fixed BOR AI hostnames, preserving the checked URL path. It never follows a redirect to Google login, external websites, customer-supplied URLs or another application route. It prints only endpoint labels, result classes and numeric HTTP status. It never sends cookies or credentials, does not call chat inference, deep database health, Tavily Extract, R2 or media, and makes no database mutations. Unit tests use fake HTTP responses only.

## What a green run DOES NOT mean

It does not test AI generation, model quota, authenticated login, user chat persistence, D1 disaster recovery, actual Reader security or production billing. Shallow health does not validate D1 query health. It does not establish global geographic availability, latency, 24/7 uptime or SLOs; one runner is not independent multi-region proof.

The existing strict read-only production readiness workflow must remain red while active Reader/Extract bindings and the legacy web capability contract fail the reviewed main security policy. This job is operational liveness only; it does not override security issues #156 and #351, recovery #382 or launch gate #385.

## Manual operation

In GitHub Actions choose "BOR AI public core liveness (manual, no inference)", select main, and manually dispatch. If any target fails, inspect the endpoint label and HTTP status. Do not automatically deploy, disable URL Reader, use paid providers or restore customer D1. A single-runner network failure is not proof of a global outage.

GitHub Actions execution still counts toward the account's included runner minutes. This workflow is intentionally manual-only, without secrets or a scheduled trigger, to avoid silent recurring usage.

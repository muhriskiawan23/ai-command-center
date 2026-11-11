# Issue #156 — DNS-pinned Node egress prototype

## Purpose and status

This directory contains an isolated Node.js transport prototype for evaluating whether a controlled egress service can close the DNS time-of-check/time-of-use gap in arbitrary public-URL fetching.

The prototype is not the production URL reader, is not wired into the Cloudflare Worker, and is not an approved production proxy. Production URL reading must remain fail-closed until every gate in issue #156 is met.

## Request path and security invariants

1. Parse and validate the URL. Only HTTP and HTTPS are accepted; credentials, custom ports, internal hostnames, and unsafe IP literals are rejected.
2. For hostnames, resolve the CNAME chain (bounded to eight hops), then collect A and AAAA records. Empty, ambiguous, looping, failed, mixed public/private, and special-use answers fail closed.
3. Select one vetted numeric address. The Node HTTP(S) request supplies a custom DNS lookup callback that returns that exact address, so the transport does not perform a second hostname lookup for the socket.
4. Preserve the original hostname in the HTTP Host header and HTTPS SNI. Keep TLS certificate verification enabled and explicitly check the certificate identity against the original hostname.
5. Verify the connected socket's remote address matches the selected peer IP before accepting the response.
6. Return redirects as single-hop results. The caller must parse and validate each Location target and invoke the transport again; this module does not automatically follow redirects.
7. Enforce request/response byte limits, DNS/request deadlines, cancellation, and bounded concurrent upstream requests. The handler requires a high-entropy bearer token and is intended only behind a private authenticated ingress.

## Files

- `tools/egress-proxy/pinned-transport.js` — DNS resolution, address classification, pinned socket transport, TLS/peer verification, and minimal authenticated single-hop handler.
- `tests/egress-proxy*.test.js` — deterministic resolver, rebinding, address classification, redirect, socket, timeout, body-limit, authorization, and concurrency tests.
- `tools/egress-proxy/containers/` — isolated Docker and Wrangler local Containers harness. The Docker test container runs with networking disabled.

## Validation evidence

The PR validation workflow runs:
- the isolated Node test suite in a Docker container with `--network none`;
- the same suite through Wrangler's local Containers runtime;
- the repository's unit tests, syntax checks, preview build, and browser E2E workflows.

The opt-in `rbndr.us` check performs DNS queries only and is disabled for pull-request events. A passing isolated suite demonstrates behavior of this Node prototype in the tested environments; it does not prove Cloudflare-hosted production routing or an actual production connection.

## Known limitations and acceptance gates

- The module is not integrated into `src/links.js` or the Worker. It must not be wired to production until architecture, ingress authentication, private routing, observability, privacy, retention, and incident-response controls are reviewed.
- A successful DNS-only rebinding check is not a production socket test.
- Cloudflare-hosted Container runtime and private VPC routing remain unproven.
- Account-wide Cloudflare egress inventory must include Workers VPC Connectivity Directory Services and every currently missing account scope. Permission-denied, unsupported, or incomplete endpoints must remain marked unknown, never interpreted as empty.
- Review request logging, URL/query handling, content retention, backups, export/deletion behavior, access controls, credential rotation, jurisdiction, and cost before any external service receives user URLs or page content.
- A controlled production smoke must independently record the actual connected peer IP and prove original-host TLS verification. It requires explicit production approval and must not be inferred from local or preview tests.

No proxy service, Cloudflare resource, secret, VPC binding, Tunnel, Gateway policy, production setting, or production traffic was created or changed by this prototype.

## Release and follow-up evidence — 11 November 2026

- PR #177 merged as `041c426bdd868708f3f20e5bd47b09734d087498`; superseded PR #170 is closed.
- Production deploy [#135](https://github.com/muhriskiawan23/ai-command-center/actions/runs/42983042701) passed on that exact commit, including live chat and Tavily web/news checks. D1 migrations were explicitly disabled.
- [Live smoke #79](https://github.com/muhriskiawan23/ai-command-center/actions/runs/42983320561) passed health, agents, malformed/empty input, CSP, and entry-script SRI checks.
- [Manual container/DNS run #44](https://github.com/muhriskiawan23/ai-command-center/actions/runs/42983189816) passed isolated Docker and Wrangler local validation. Its external DNS job **failed** with `dns_timeout`; it is not accepted external rebinding evidence.
- [Account audit #13](https://github.com/muhriskiawan23/ai-command-center/actions/runs/42983236790) remains **PARTIAL / ACTION REQUIRED**. Directory Services, CNI, interconnects, virtual networks, and Gateway policies returned 403. On-ramps returned 404. Authorized Tunnel/Mesh inventories were empty, which does not establish absence of other paths.

The live DNS test now uses a 25-second evidence budget, private cancellable resolvers, and bounded retries for DNS failures. It reports public/private observations and DNS failure counts. Both public and private answers remain mandatory: an unavailable service still fails, and no resolver or timeout error counts as successful evidence. These test-only changes do not relax transport policy.

Next required evidence:
1. Obtain authorized read-only Cloudflare inventories for the denied APIs and resolve the on-ramp endpoint/entitlement uncertainty. Never interpret denied access as no resources.
2. Complete an independent privacy/retention review and a concrete hosted architecture/cost/access-control decision.
3. Validate the selected hosted runtime using synthetic fixtures, including observed numeric peer IP and original-host TLS identity, before enabling the URL reader.

Production deployment of the application does not deploy or approve the standalone proxy. Issue #156 remains open and URL reading remains fail-closed.

## Audit credential and coverage follow-up — 11 November 2026

[Account audit #14](https://github.com/muhriskiawan23/ai-command-center/actions/runs/42994105016) still returned 403 for Directory Services, CNI, interconnects, virtual networks and Gateway policies, and 404 for on-ramps. Updating a named dashboard token did not establish that GitHub uses that same token. No permission or credential identity claim follows from the token's display name.

The audit workflow now prefers `CLOUDFLARE_AUDIT_API_TOKEN`, falling back to the existing `CLOUDFLARE_API_TOKEN` for compatibility. It prints only which secret source was selected, never a token value. Configure a dedicated account-scoped read-only audit token directly in GitHub Actions secrets; do not send credentials through chat or replace the working deployment credential. A separate secret does not itself grant any new Cloudflare access.

Partial coverage now exits nonzero after writing the full summary. Reported additional pages or continuation cursors also make coverage incomplete. These checks prevent a green job from disguising denied requests or a known truncated inventory; they do not resolve account entitlement, unknown pagination, the on-ramp endpoint, or hosted peer-IP/TLS evidence. No Worker deployment is required for this workflow-only change. Production URL reading remains fail-closed.

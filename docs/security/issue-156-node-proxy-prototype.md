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

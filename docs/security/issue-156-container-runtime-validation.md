# Issue #156 — Isolated Node.js container validation

Status: **Harness added for CI validation. Not a Cloudflare deployment or production proof.**

## Purpose

The Node.js egress transport uses low-level HTTP(S) client behavior, DNS record resolution, TLS identity checks, and actual socket peer inspection. Those behaviors must be tested in a real Linux Node.js process rather than inferred from the Cloudflare Workers Node.js compatibility shims.

This harness packages the existing transport and its egress-proxy tests in a Node.js 22 Linux container. The test container is run with Docker networking disabled.

## Run locally

From the repository root, with Docker Engine available:

```sh
docker build --file tools/egress-proxy/containers/Dockerfile --tag bor-ai-egress-transport-test .
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m bor-ai-egress-transport-test
```

The image installs OpenSSL at build time because the HTTPS integration tests generate local test certificates. The test execution itself has no network access. Fixtures bind only to loopback.

## What a passing run demonstrates

- The transport module loads under Node.js 22 on Linux.
- Existing DNS policy and fail-closed unit tests execute in the container.
- HTTP socket tests can verify the connected peer address and preserve the original Host header.
- HTTPS socket tests can verify peer address, original DNS-name SNI, and certificate identity.
- Existing timeout, response-size, cancellation, request-body, and concurrency tests execute in the container.

## What it does not demonstrate

- It is not a Cloudflare Containers cloud-runtime execution.
- It does not establish Cloudflare account entitlement, VPC Service routing, Tunnel configuration, or production egress policy.
- It does not perform public-internet DNS rebinding tests; network access is intentionally disabled.
- It does not prove production privacy, retention, or operational controls.
- It does not authorize deployment, a production binding, or enabling production URL reading.

## Cloudflare-specific next gate

Cloudflare documents Containers as Linux container workloads running in isolated microVMs. Local Docker validation is a useful zero-Cloudflare-cost compatibility gate, but a separate Wrangler local-container run and, only if explicitly funded and approved, a controlled Cloudflare-hosted runtime smoke would provide stronger environment-specific evidence.

Cloudflare Containers currently require the Workers Paid plan. Do not enable or deploy a remote Container merely to run this test while the zero-cost constraint remains in force.

## Safety boundary

This harness makes no production changes and sends no user URLs or page content to an upstream service. The GitHub Actions job builds and runs a local image only, with container networking disabled.

# Issue #156 — Isolated Node.js container validation

Status: **Docker and Wrangler local-Containers harness added. Cloudflare-hosted runtime and production proof remain outstanding.**

## Purpose

The Node.js egress transport uses low-level HTTP(S) client behavior, DNS record resolution, TLS identity checks, and actual socket peer inspection. Those behaviors must be tested in a real Linux Node.js process rather than inferred from Cloudflare Workers Node.js compatibility shims.

This validation has two zero-Cloudflare-cost layers:

1. Run the existing transport suite inside a Node.js 22 Linux Docker image with Docker networking disabled.
2. Run the same suite through a Worker using Cloudflare's Durable Object Container API under `wrangler dev`. Wrangler starts the image locally through a Docker-compatible engine; the Durable Object starts it with `enableInternet: false`.

## Prerequisites

- Docker-compatible CLI and engine running locally.
- Node.js/npm available to run Wrangler.
- Wrangler 4.136.0 or later for local development with the Durable Object scheduling policy; CI pins Wrangler 4.141.0.

Cloudflare documents that local Container-enabled Workers run through `wrangler dev` and Docker. The local runtime is useful for compatibility testing but differs from deployed Containers in some Linux/network details.

## Run locally

From the repository root:

```sh
docker build --file tools/egress-proxy/containers/Dockerfile --tag bor-ai-egress-transport-test .
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m bor-ai-egress-transport-test

npx --yes wrangler@4.141.0 dev --config tools/egress-proxy/containers/wrangler.local.jsonc --ip 127.0.0.1 --port 8787
```

In another terminal, trigger the local Container test:

```sh
curl --fail --silent --show-error -X POST http://127.0.0.1:8787/run
```

The Worker starts a local Container with public internet access disabled and forwards the test request to its loopback-only test server. The container runs the four egress-proxy test files and returns the Node test-runner output.

The image installs OpenSSL at build time because HTTPS integration tests generate local test certificates. No user URL or page content is used.

## What a passing run demonstrates

- The transport module loads under Node.js 22 on Linux.
- Existing DNS policy and fail-closed unit tests execute in the container.
- HTTP socket tests verify the connected peer address and preserve the original Host header.
- HTTPS socket tests verify peer address, original DNS-name SNI, and certificate identity.
- Existing timeout, response-size, cancellation, request-body, and concurrency tests execute in the container.
- The Wrangler local Durable Object Container API can build, start, health-check, and route a request to the isolated test process.

## What it does not demonstrate

- It is not a Cloudflare-hosted Container execution in the account.
- It does not establish Cloudflare account entitlement, VPC Service routing, Tunnel configuration, or production egress policy.
- It does not perform public-internet DNS rebinding tests; the Container is intentionally started with `enableInternet: false`.
- It does not prove production privacy, retention, or operational controls.
- It does not authorize deployment, a production binding, or enabling production URL reading.

## Cloudflare-specific next gate

Cloudflare documents Containers as Linux workloads running in isolated microVMs. Wrangler local development runs those containers in Docker. This provides a useful zero-Cloudflare-cost compatibility gate, but deployed Containers have documented environment differences. A separately approved Cloudflare-hosted smoke would provide stronger platform-specific evidence.

Cloudflare Containers currently require the Workers Paid plan. Do not enable or deploy a remote Container merely to run this test while the zero-cost constraint remains in force.

## Safety boundary

The harness is test-only. The local Container is started with internet access disabled. The GitHub Actions job builds and runs local images only; it does not deploy a Worker or Container, create VPC/Tunnel resources, create secrets, or alter production.

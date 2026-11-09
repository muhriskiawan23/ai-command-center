# Issue #156 — egress architecture decision record

Date: 2026-11-09  
Status: **Investigation only; production URL reading remains fail-closed.**

## Executive decision

Do not use ordinary Worker `fetch()`, a DNS preflight followed by `fetch()`, or a Worker TCP socket as the DNS-pinning implementation.

The strongest first-party-compatible candidate to prototype is a **dedicated, user-controlled egress proxy reachable only through a Cloudflare Workers VPC Service**. The proxy must perform DNS validation and the actual outbound TCP/TLS connection itself. Cloudflare Workers VPC/Gateway can provide a private Worker-to-proxy path, policy enforcement and audit logs, but Gateway routing alone is not proof that the origin connection used the vetted IP.

No VPC binding, tunnel, Gateway policy, proxy, secret, or production configuration is created by this decision record.

## Evidence from current Cloudflare documentation

### Workers VPC Network + Gateway

Cloudflare documents that a VPC Network binding using `network_id: "cf1:network"` can send Worker public-Internet traffic through Cloudflare Gateway, applying Zero Trust DNS/HTTP/Network policies and producing Gateway logs. The account must have at least one active Tunnel, Mesh node, or WAN on-ramp. Gateway Forward policies can drop Workers VPC HTTP traffic and must be accounted for.

The account audit for the deployed release found:
- Tunnel inventory: authorized, zero visible.
- Dedicated Mesh node inventory: authorized, zero visible.
- Virtual networks and Gateway policies: HTTP 403.
- CNI and network interconnect inventory: HTTP 403.
- Magic Cloud Networking on-ramps: HTTP 404 (the list API is documented as Closed Beta; 404 is not evidence of an empty inventory).

Therefore the account prerequisite for `cf1:network` is not currently demonstrated. Even if enabled later, Gateway policies/logs are network enforcement and observability, not a per-request proof of the actual peer IP chosen for an arbitrary DNS name. This option is useful defense-in-depth, not the DNS-pinning primitive by itself.

References:
- https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/
- https://developers.cloudflare.com/workers-vpc/
- https://developers.cloudflare.com/changelog/product/workers-vpc/

### VPC Network TCP and Workers TCP sockets

The VPC Network binding's documented `connect()` currently supports plaintext TCP only. Cloudflare's public TCP Sockets API documents `secureTransport` and `startTls()`, but does not document an API contract for connecting to a vetted numeric IP while separately overriding TLS SNI / expected certificate hostname. A hostname passed to `connect()` is not a safe pinning primitive because resolution happens at connection time.

Do not depend on undocumented runtime internals or assume `startTls()` accepts an unadvertised hostname override.

References:
- https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/#runtime-usage
- https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/

### VPC Service to a controlled egress proxy — preferred prototype

VPC Services route a Worker request to a pre-registered host and port behind Cloudflare Tunnel. For HTTPS, the Worker-supplied URL hostname is used as SNI and the tunnel verifies the origin certificate (default `verify_full`). The service's configured host/port, not a caller-controlled URL host, determines the backend routing destination.

This can give BOR AI a narrowly scoped, private binding to a proxy operated in infrastructure controlled by the project owner. The proxy—not the Worker—must own the public-origin connection and implement the security boundary.

References:
- https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- https://developers.cloudflare.com/workers-vpc/api/

## Required proxy contract

For every single HTTP hop, the proxy must:

1. Accept only authenticated requests from the BOR AI Worker over the private VPC Service; never expose an unauthenticated general-purpose open proxy.
2. Parse and canonicalize the URL. Permit only HTTP/HTTPS and ports 80/443; reject userinfo, malformed hosts, IP literals outside the global-unicast/public ranges, and unsupported schemes.
3. Resolve the hostname itself and inspect the complete CNAME chain and every A and AAAA answer. Reject the entire destination if any answer is private, loopback, link-local, multicast, reserved, IPv4-mapped IPv6, or a cloud metadata endpoint. Bound CNAME depth and detect loops.
4. Select one vetted numeric address and open the TCP connection to that exact address (not the hostname).
5. For HTTPS, perform TLS over that connected socket with the original URL hostname as SNI and verify the certificate chain and hostname against that original hostname. Never disable certificate verification.
6. Send the original hostname in HTTP Host (and preserve the correct port semantics). Record the selected peer IP and TLS verification outcome as bounded, privacy-minimized security metadata.
7. Disable automatic redirects. Return one hop to the Worker; the existing reader manually validates each Location and sends a new proxy request for the next hop. Never forward credentials across origins.
8. Enforce connect/read/total timeouts, response streaming byte caps, bounded concurrency, header allow/deny rules, and cancellation when the caller aborts.
9. Fail closed on DNS errors, mixed public/private DNS answers, TLS errors, socket errors, proxy unavailability, malformed responses, and policy uncertainty. There must be no fallback to direct Worker `fetch()`.

The proxy must have an explicit data-retention policy: do not persist requested URLs, query strings, request bodies, or response bodies by default. Logs should contain only minimal operational fields (timestamp, decision, peer IP, coarse hostname policy category, byte counts, and trace ID) with a documented short retention period. Review any provider/hosting jurisdiction, access, backups, and cost before deployment.

## Required isolated proof-of-concept tests

- Stable public A and AAAA answers; prove the TCP peer equals the selected vetted numeric IP.
- DNS rebinding: public preflight followed by a private answer; prove no connection is made to the private answer.
- Mixed public/private A/AAAA and CNAME chains; reject all mixed or unsafe answers.
- CNAME loop/depth limit, IPv4-mapped IPv6, unusual numeric IPv4 forms, special-use IPv6, metadata IPs.
- HTTPS: valid certificate for original hostname succeeds; wrong hostname, expired/untrusted certificate, and SNI mismatch fail.
- Redirect to private/metadata IP and redirect across hostnames; every hop re-resolves and revalidates.
- Oversized response, slow headers/body, timeout, abort, connection reset, malformed URL and proxy outage.
- Verify via proxy-side socket instrumentation that the actual connected peer IP is the exact vetted IP; a DNS log or Gateway log alone is insufficient.
- Run only against controlled test domains and a non-production Worker first. Production smoke is a later gate.

## Cloudflare read-only audit token

The last post-PR-#168 audit (run 42630155317) executed successfully but reported partial coverage. The documented API permission matrix indicates these **read-only** scopes are required to inspect all relevant inventory:

| Inventory | Accepted read permission(s) |
|---|---|
| Tunnels | `Cloudflare One Connectors Read`, `Cloudflare One Connector: cloudflared Read`, or `Cloudflare Tunnel Read` |
| Dedicated Mesh nodes | `Cloudflare One Connectors Read` or `Cloudflare One Connector: WARP Read` |
| Virtual networks | `Cloudflare One Networks Read` or `Cloudflare Tunnel Read` |
| Gateway account/policy metadata | `Zero Trust Read` |
| CNI and network interconnects | `Magic WAN Read` or `Magic Transit Read` |
| Magic Cloud Networking on-ramps | `Magic WAN Read` (endpoint is currently documented as Closed Beta) |

The minimum practical additive read-only scopes to resolve the observed 403s are:
- `Cloudflare One Networks Read`
- `Zero Trust Read`
- `Magic WAN Read` (or `Magic Transit Read` for CNI/interconnect inventory; Magic WAN Read is the documented on-ramp scope)

Add `Cloudflare One Connectors Read` only if the existing token does not already authorize the Mesh/Tunnel inventory endpoints. Do not grant Edit/Write permissions. Update the token in Cloudflare and replace the GitHub Actions secret `CLOUDFLARE_API_TOKEN`; never paste the token into an issue, chat, workflow output, or repository.

Official API references:
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/networks/subresources/virtual_networks/methods/list/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/methods/list/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/methods/list/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/warp_connector/methods/list/
- https://developers.cloudflare.com/api/resources/network_interconnects/subresources/cnis/methods/list/
- https://developers.cloudflare.com/api/resources/network_interconnects/subresources/interconnects/methods/list/
- https://developers.cloudflare.com/api/resources/magic_cloud_networking/subresources/on_ramps/methods/list/

## Current implementation status

`src/links.js` deliberately returns a fail-closed error when no explicit transport is injected. The production caller supplies no generic `fetch` transport. Tests may inject a fake transport. Redirects are manually revalidated; response size, content type, timeout and page-text limits are enforced.

This implementation must stay disabled in production until the proxy transport and the isolated peer-IP/TLS proof pass. This document does not close Issue #156.

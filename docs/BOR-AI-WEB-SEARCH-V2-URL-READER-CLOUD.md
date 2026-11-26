# URL Reader staging without Termux

26 November 2026 WIB. Base checkpoint `13be73f1b01c66e3112c0a230087277ef442000a`.

## Candidate

Use a dedicated **Render Free Web Service** for bounded staging only. The existing Node proxy runs on loopback. A bundled cloudflared connector provides the private route from a dedicated Cloudflare Tunnel and Workers VPC Service. The public Render listener serves only `GET /health`. Render and Cloudflare credentials are separate, and the launcher removes the sibling credential from each child's environment. The container runs as a non-root user. This path reuses the existing DNS policy, socket pinning and observed-peer verification, original-host TLS verification, bearer check, single-hop redirect protocol, timeout and response-size caps. No application transport or production blueprint changed.

Cloudflare Workers VPC is free during beta and can forward to a private loopback service. Workers Containers require Workers Paid. Ordinary Worker fetch cannot attest the connected IP. For outbound Workers TCP, workerd describes the address reported by `opened` as derived from the host and port passed to `connect()`, which is insufficient as independent observed-peer evidence. The existing Railway project has a live proxy and a staged-only Cloudflare connector in its production environment. The connector is not running, and a zero-cost staging allocation there was not verified. The project and pending changes were left untouched.

Render Free is a staging candidate. The provider documents cold starts, idle spin-down and resource allowances. Render may bill overages when a payment method is attached. A zero-charge workspace must be confirmed before provisioning. Spin-down may take the tunnel offline and the reader must fail closed. Do not use keep-alives to change Free-plan behavior. The public health check reports listener liveness, not current private connectivity.

## Evidence

- New launcher passed shell syntax checks and the Node host passed syntax checks. Parsed the separate Blueprint and verified Free Docker, the feature branch, automatic deployment off, and no inline credentials.
- Local cloud-topology smoke passed. It used socket listeners and a simulated connector. Public health returned 200 and the public proxy path returned 404 even with a valid synthetic bearer. The private port denied requests without the bearer with 401 and accepted the correct bearer before rejecting an empty payload with 400. The synthetic connector saw only its tunnel credential.
- **54/54 URL Reader and defensive transport tests passed** locally, including SSRF policy, DNS rebinding, redirects, peer/TLS, authentication and response caps. No paid provider calls.
- Live staging remains v35 at 100% and the previous tunnel has zero active connections. This run did not build a real hosted container, provision a Render service, connect a new tunnel, bind a VPC Service, or run the hosted private-path proof. The connected browser reached the Render sign-in screen. The container engine was unavailable locally. The Reader remains off.

## Resume once signed in

1. Verify a Render workspace with Free compute and no payment method or supplemental billing exposure. Import only `render.url-reader-staging.yaml` from the feature branch. Use a dedicated staging tunnel and add its token and the independent proxy bearer using provider secrets. Keep the private origin at `127.0.0.1:10001`. Do not create a public tunnel hostname for the proxy.
2. Use a staging-only Workers VPC Service pointing to `127.0.0.1:10001` on that tunnel. Deploy an isolated authenticated probe with that binding and its matching proxy bearer through the supported secret handoff. Keep the application Reader off and retain staging v35 as the safe active deployment.
3. Verify public `/fetch` remains unreachable and run the existing hosted URL Reader checks for the private path. Record actual matched socket peer and TLS identity, valid HTTPS extraction, redirect/DNS rejection, authorization, size/time limits, and connector behavior when idle. Clean up the staging probe and keep the Reader disabled until the hosted evidence supports release.

[Render Free limits](https://render.com/docs/free) · [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/) · [Cloudflare Workers VPC setup](https://developers.cloudflare.com/workers-vpc/get-started/) · [workerd socket metadata](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/sockets.h)

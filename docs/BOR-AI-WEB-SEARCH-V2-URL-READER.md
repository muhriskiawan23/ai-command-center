# BOR AI Web Search V2 — URL Reader staging checkpoint

26 November 2026 WIB. Base checkpoint `49b5328c1c8c3716391199fb97c0dc31e19175bf`.

## Existing infrastructure

Cloudflare lists HTTP VPC Service `bor-ai-termux-egress` (`01a1cefa-5d93-7da2-bfce-91aae9fe11f1`). Tunnel `bor-ai-private-egress` is down, with zero active connectors. The account-side service exists and the origin and connector on the owner-controlled Termux device are unavailable from the runner. The active staging Worker has neither `EGRESS_PROXY` nor `EGRESS_PROXY_TOKEN`. Its Google integration and URL Reader smoke remain disabled. Staging v35 stayed at 100% traffic, with no cron. Production was read only. No paid service or provider request was made.

Wrangler 4.160.0 dry run passed with the isolated staging D1, the existing VPC Service bound as `EGRESS_PROXY`, AI, and version previews disabled in the generated configuration. This verified the local build, not Cloudflare binding-write permissions or the ability to reach the private origin. The generated configuration was removed after the dry run.

## Security and test evidence

- Bound the Worker-side proxy JSON envelope to 1,465,536 bytes before decoding/parsing. Oversized or malformed streaming responses fail closed. This complements the existing decoded-content cap of 1,000,000 bytes and the proxy's own response limit.
- The reviewed path requires an explicit enable flag, a private VPC binding, and bearer authentication. It validates URLs before dispatch, resolves and vets DNS at the proxy, pins the connection to an approved IP, verifies the socket peer and the original HTTPS identity, and checks redirect destinations before the next hop. External page text is treated as untrusted. The probe logs only bounded status metadata. Original URLs in signed-in chat messages remain subject to the existing retention policy.
- URL Reader and proxy baseline: **71/71 passed**, including URL parsing and reading, redirect checks, DNS and peer policy, socket/TLS tests, authentication, and body/time limits. Targeted post-change suite: **17/17 passed**, including the new streaming size test and existing runtime probe and socket checks. No OpenAI or Gemini tests were rerun.
- A local composite smoke used the production reader and adapter against the real HTTP proxy handler on loopback, with synthetic DNS and origin. It extracted the fixture title and text, rejected a mismatched bearer and admitted one synthetic origin request. No external network call was made by the test.
- Hosted `POST /smoke/url-reader` without the staging operator bearer returned **HTTP 401** (`operator_auth_required`). Hosted authenticated reads, current private-path DNS/TLS proof, and connector stability remain unverified.

## Resuming hosted validation

1. On the existing Termux device, start the existing egress proxy and Cloudflare connector using the saved credentials and previous IPv4/HTTP2 launcher. Confirm the tunnel shows Healthy. Provide the existing matching proxy bearer to the authorized staging runner through a masked secret handoff if it is absent. The Cloudflare tunnel token and the application proxy bearer are separate credentials. Keep values out of chat and logs.
2. Prepare the staging version with the private VPC binding, the matching stage token, and the Reader disabled. Consult both the deployed and latest uploaded versions before any update. The latest uploaded v38 currently lacks three stage secrets present in active v35, so strict inheritance from v38 cannot preserve that active configuration. Use a safe version or a dedicated staging probe with an explicit least-privilege binding set. Verify all expected flags and bindings and preserve v35 as the safe active version until the candidate is validated.
3. Via the authorized staging probe, verify bearer rejection, public HTTPS extraction and the existing hosted negative fixtures. Check connector stability and keep the public Reader disabled pending the hosted proof and the independent security/privacy review. Restore staging safe flags and remove any temporary probe resources.

[Prior private-path proof](security/private-egress-runtime-evidence-2026-11-13.md) · [Engineering security/privacy review](security/url-reader-engineering-review-2026-11-13.md) · [Cloudflare VPC Services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)

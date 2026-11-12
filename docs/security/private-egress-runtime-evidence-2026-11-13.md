# Private egress runtime evidence — 13 November 2026

Decision: **bounded private-path proof PASS; production URL Reader remains OFF.**
This records a successful synthetic run, not completion of all release gates.

## Exact evidence

- [Workflow run 43305293141, attempt 2](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43305293141/attempts/2).
- [Job 131496913220](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43305293141/job/131496913220), conclusion `success`.
- Executed source commit: `70e5858a6dd381f3d2a9f7cc089f168f76d025a1`.
- Run finished 13 November 2026, 04:15 WIB (12 November 2026, 21:15 UTC).
- At 21:14:52 UTC the Cloudflare API reported the configured Tunnel `healthy`.
- At 21:14:59 UTC the authorized temporary Worker returned HTTP 200 and all fixed proof checks passed.
- Temporary proof Worker deletion was confirmed at 21:15:04 UTC.
- Operator used one cloudflared connector forced to IPv4 + HTTP/2 on Termux, using the existing token file. No tunnel token rotation was performed.
- Prior IPv6 edge connections disconnected together. The successful IPv4 run does not by itself prove the cause of those disconnects or long-term reliability.

## Verified coverage

| Check | Runtime evidence / boundary |
| --- | --- |
| Deployment | Worker settings verified the exact configured VPC Service binding and a single active 100% deployment, both before and after secret installation |
| Credential | Worker secret-name metadata confirmed EGRESS_PROXY_TOKEN present; secret values were not logged |
| Reader switch | Deployed URL_READER_ENABLED was verified false; no activation performed |
| Probe access | Public request denied with 401; authorized fixed-target probe returned 200 |
| Private path | Temporary Worker → existing VPC Service → configured Tunnel → authenticated Termux proxy responded successfully |
| Proxy authentication | Missing and incorrect authentication both denied with 401 |
| IPv4 loopback and metadata | Both denied with HTTP 502 and exact policy code unsafe_ip_literal |
| IPv6 loopback | Denied with HTTP 502 and exact existing policy code invalid_hostname |
| Public HTTPS | Synthetic example.com request succeeded through the production adapter |
| Peer proof | Adapter checked selectedPeerIp = observedPeerIp = peerIp and peerIpVerified = true |
| TLS proof | Adapter required trusted TLS and original-host identity verification for example.com |
| Cleanup | Run-specific temporary Worker deleted successfully |

The private proxy reports socket metadata produced by pinned-transport.js; the production adapter validates it. The CI result records booleans, not raw addresses or content. This is not an independent review of the instrumentation. It does not prove separate IPv4 and IPv6 origin-family coverage.

The former IPv6 probe expectation was incorrect: the proxy rejects IPv6 loopback at its hostname policy before literal-IP classification. PR #217 corrected the expected denial code without changing the proxy policy. A real local HTTP-handler regression independently verifies that the three forbidden targets cause zero resolver calls and zero origin socket requests. That local test is not presented as hosted DNS-rebinding proof.

## Still required before activation

- Hosted negative fixtures for mixed public/private DNS, CNAME loops and rebinding; redirect revalidation; wrong-host, expired and untrusted certificates; timeouts, cancellation and response limits.
- Separate origin-family coverage if required by the release matrix.
- Operational stability while the phone is backgrounded, disconnected or rebooted; monitoring, operating limits, ownership, incident response and retention decisions.
- Named independent privacy/retention review, including synthetic deletion/access tests and provider backup/log boundaries.
- Review of the socket instrumentation and linkage of all remaining release evidence.

The owner has authorized activation only if all required security checks pass. This run does not establish that condition. Keep the production switch false and Issue #156 open. See [the release gates](issue-156-production-release-gates.md).

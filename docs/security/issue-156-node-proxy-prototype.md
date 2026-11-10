# Issue #156 — Node egress proxy prototype notes

Date: 2026-11-09  
Status: **Isolated prototype and loopback socket/TLS integration tests added. Not deployed; production URL reading remains fail-closed.**

## Why this addendum exists

The current ADR selects a dedicated, user-controlled egress proxy behind a narrowly scoped Cloudflare Workers VPC Service as the preferred candidate. This note narrows the transport implementation to a testable Node.js prototype without creating infrastructure or moving user traffic.

## Candidate transport inside the proxy

A Node.js service can use the documented low-level HTTP/TLS client interfaces rather than a generic \`fetch()\`:

1. Parse the requested URL and reject anything except HTTP/HTTPS on the default ports, credentials, malformed hostnames, and disallowed IP literals.
2. Resolve and walk the complete CNAME chain with explicit depth and loop bounds; collect every A and AAAA address. Reject the entire hostname if any answer is unsafe or if resolution is incomplete/ambiguous.
3. Select one validated numeric address for this hop.
4. For HTTP, call \`http.request\` with the original hostname as the request hostname and a custom \`lookup\` callback that returns only the selected vetted numeric address. Set the HTTP \`Host\` header explicitly to the original authority.
5. For HTTPS, do the same with \`https.request\`, explicitly set \`servername\` to the original DNS hostname, keep certificate verification enabled (\`rejectUnauthorized: true\`), and do not provide a permissive \`checkServerIdentity\` override. Use a non-reusing per-request agent/socket configuration so a pooled connection cannot silently reuse a different peer for a later URL.
6. On the connected socket, inspect \`remoteAddress\` and fail the request unless it exactly matches the selected numeric address after canonical IP normalization. For HTTPS, also verify the negotiated TLS socket's servername and peer certificate identity against the original hostname. Emit only bounded, privacy-minimized evidence fields.
7. Disable automatic redirects and return only the single-hop response. The Worker reader already handles redirects manually; each next hop must be a new authenticated proxy request and repeat the full DNS and peer checks.

An isolated implementation now exists at \`tools/egress-proxy/pinned-transport.js\`. Its production entry point validates the URL, walks CNAMEs, rejects mixed/unsafe DNS answers and resolver errors, selects one numeric address, uses a one-hop Node HTTP(S) request with a custom lookup, verifies the connected socket peer, and preserves the original HTTP Host / TLS SNI and certificate identity. Redirect responses are returned without following them. The private handler is an unmounted function only; no listener, service, Tunnel, VPC binding, secret, or deployment was created. The exported \`requestOneHop\` function is an internal test seam; production callers must use \`fetchPinned\` so URL and DNS policy runs first. The loopback tests exercise actual socket peer, Host, SNI, and certificate checks; they do not prove public-internet egress, real DNS rebinding timing, Cloudflare VPC routing, or production privacy controls.

## Cloudflare VPC Service request shape

Cloudflare's current VPC Service documentation states that the service's configured host and port determine the private backend route. The hostname in a Worker \`fetch()\` request is used for the HTTP \`Host\` header and, for HTTPS, SNI; it does not select the backend route.

For the prototype, prefer a single fixed VPC Service backend and an HTTP request over the private Worker-to-service route, with the target URL carried in a bounded JSON body rather than overloading the inbound \`Host\` header. The proxy must treat that body as untrusted input and must not derive the backend route from it. This avoids sending an arbitrary internet target hostname as SNI to the private proxy's own TLS endpoint. Cloudflare documents that HTTP VPC Service traffic is encrypted to the network via Tunnel, then plaintext from the tunnel to the private service; the private network segment and host therefore need an explicit trust and access-control review.

The proxy must authenticate requests independently (for example, a rotated, high-entropy Worker-to-proxy credential), reject requests from any other caller, and be reachable only through the intended Tunnel/VPC Service path. No public listener or general-purpose open-proxy interface is acceptable.

## Node.js API references and limits

- Node \`https.request()\` accepts TLS options including \`servername\`; the default certificate validation must remain enabled: https://nodejs.org/api/https.html
- Node \`tls.connect()\` documents the \`servername\` SNI option and hostname identity checking: https://nodejs.org/api/tls.html
- Node \`net.connect()\` documents the custom \`lookup\` callback option used by the HTTP/TLS client socket path: https://nodejs.org/api/net.html
- Node DNS APIs distinguish OS name resolution (\`dns.lookup\`) from DNS record queries (\`dns.resolve*\`); the prototype must explicitly inspect CNAME, A and AAAA results rather than assume one resolver call proves the full chain: https://nodejs.org/api/dns.html
- Cloudflare VPC Services document fixed backend routing, HTTP Host/SNI behavior, and TLS verification modes: https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- Cloudflare VPC binding docs describe the VPC Service binding's fixed route and Worker request behavior: https://developers.cloudflare.com/workers-vpc/api/

Node's custom \`lookup\` hook is a way to direct the socket connection to a selected address, but it is not by itself sufficient proof. The implementation must test the actual socket peer address and TLS identity, including redirects, keep-alive behavior, IPv4/IPv6, and error paths.

## Prototype test matrix

The current tests use local loopback fixtures only; no public target or user content is contacted.

**Implemented and covered by tests:**
- Representative IPv4/IPv6 public-address classification and rejection of common special-use/private ranges, including the IANA-registered IPv6 AS112 anycast prefix (2620:4f:8000::/48); the registry is used conservatively, with special-purpose ranges blocked even where IANA marks some as globally reachable. IPv6 NAT64 well-known translation (64:ff9b::/96) and local-use translation (64:ff9b:1::/48) prefixes are also explicitly blocked because they can encode IPv4 destinations.
- CNAME traversal, loop and depth-limit rejection; empty terminal DNS answer rejection; rejection of mixed public/private DNS answers and a deterministic public-to-private rebinding on the next hop; bounded DNS resolution under the same request deadline, including caller cancellation before any upstream socket is opened; a deterministic rebinding race where DNS changes from public to loopback after preflight while the transport retains the vetted numeric peer.
- Fail-closed handling for DNS resolver errors other than an explicit no-data response.
- URL rejection for credentials, non-default ports, unsupported schemes, and private IP literals.
- Selection of one numeric DNS answer, single-hop redirect return without following, and the configured response-size default.
- Actual HTTP loopback socket peer verification and preservation of the original Host authority.
- Actual HTTPS loopback socket peer verification, original DNS-name SNI, trusted test-certificate hostname validation, wrong-host certificate rejection, rejection of an untrusted self-signed certificate, rejection of an expired certificate signed by a trusted test CA, and IP-literal HTTPS with no SNI but a validated IP subject alternative name. DNS-name requests always set SNI; IP-literal HTTPS intentionally omits SNI.
- HTTP 101 protocol upgrades are rejected immediately and the upgraded socket is closed; CONNECT tunnel events are also rejected defensively.
- The authenticated handler rejects unauthorized, malformed, oversized, and stalled requests; applies a four-request default upstream concurrency cap with 429 backpressure; minimizes response fields; and cancels upstream work on client disconnect without writing to a closed response. Real HTTP server integration tests also verify oversized and stalled request bodies receive controlled 413/408 responses with connection closure, rather than a client-side socket reset.
- IPv6 loopback socket peer verification when supported by the runner; runtime response byte-cap enforcement; total-request timeout abort.

**Still outstanding:**
- Live DNS rebinding race tests against an external authoritative DNS service and production-like resolver behavior; deterministic tests now cover both a public-to-private answer change between preflight and transport and a private answer on the next redirect hop.
- Exhaustive IPv4/IPv6 edge-case fuzzing beyond the representative special-purpose ranges and IPv6 loopback integration already covered.
- Slow headers/body, connection reset, malformed response, and proxy-down behavior; caller cancellation is covered at the real socket primitive, handler wiring, and DNS-resolution levels, while runtime response-size and total-timeout aborts have local socket tests. The DNS deadline stops waiting and prevents transport from starting; the underlying Node resolver operation itself is not cancellable through the promises API.
- Independent verification that no URL, query, request body, or response body is persisted and that logs contain only approved metadata.
- End-to-end proof that the Worker has no direct-fetch fallback when a proxy binding is absent or errors.

The loopback integration tests deliberately call the internal low-level socket seam with a loopback peer; they prove the actual socket and TLS behavior in a controlled fixture, not that a private address can pass production URL/DNS validation. The production entry point `fetchPinned` retains the public-address and URL checks.
 
## Explicit non-goals

- Do not create a Cloudflare Tunnel, VPC Service, VPC Network binding, Gateway policy, proxy host, secret, or production deployment in this PR.
- Do not transfer live user URLs or page content to any new provider.
- Do not claim Issue #156 is complete or enable production URL reading.
- Before deployment, obtain a documented decision on hosting/provider, jurisdiction, access controls, backups, retention, credentials/rotation, incident response, and recurring cost.
- Keep the Cloudflare read-only account audit separate; a successful Actions job is not proof of complete audit coverage.

## Current gate

This document and prototype are engineering artifacts only. The local socket/TLS integration proof is partial and is not production evidence. Production remains fail-closed until the remaining transport tests, independent security review, privacy/provider review, Cloudflare account prerequisites, and a separately approved controlled production smoke all pass.


## Address-registry reference

The conservative IPv4/IPv6 denylist was checked against the IANA Special-Purpose Address Registries. This implementation deliberately rejects special-purpose blocks even when individual IANA entries are marked globally reachable; this favors SSRF resistance over reachability to those exceptional destinations. Regression inputs also cover IPv6 discard-only/dummy prefixes (outside the accepted 2000::/3 global-unicast range), IETF protocol-assignment space, AMT and AS112 assignments within 2001::/23, and the SRv6 SID block outside global unicast. The classifier's global-unicast gate rejects out-of-range special-use space; explicit denylist entries cover selected special-purpose prefixes inside 2000::/3.

- IPv4: https://www.iana.org/assignments/iana-ipv4-special-registry
- IPv6: https://www.iana.org/assignments/iana-ipv6-special-registry

## Privacy data-flow finding — conversation-linked URL metadata

A source-level review of the current Worker path confirms that the statement “page content is not stored” is true for the fetched HTML/text body, but it is not equivalent to “URLs are not persisted.” The current behavior is:

- The original user message is stored in `messages.content`; when it contains a URL, that can include its path, query string, and fragment.
- `summarizeLinks(results)` emits successful-source fields `url` / `requestedUrl`, `resolvedUrl`, `host`, `resolvedHost`, `title`, `chars`, and `truncated`. For failed sources it emits `requestedUrl`, `host`, and `reason`.
- `persistConversation(..., links)` serializes these summaries into the assistant message's `messages.links_json` column. Conversation-history and idempotency-recovery reads parse and return this field to the signed-in user.
- The fetched page body itself is not included in `links_json`; the integration test asserts that the article text is absent from persisted message rows. That test does not establish that URL query parameters or fragments are absent.

**Approved policy and implementation:** source metadata written to `messages.links_json` now strips URL username/password credentials, query strings, and fragments from `url`, `requestedUrl`, and `resolvedUrl` before database persistence. Scheme, host, and path remain available for source display/navigation. The live chat response can still contain the original URL fields, and the original user message remains unchanged in `messages.content`; this change is deliberately limited to persisted source metadata. A regression test uses a URL containing a token-like query value and fragment, then verifies those values are absent from stored/history metadata. This is not a retroactive cleanup: existing rows are not migrated, and URL secrets in original message content remain subject to normal conversation retention/deletion.

**Privacy implication:** URLs can contain bearer-like query parameters, reset links, document identifiers, search terms, or other sensitive path/query material. Those values may therefore be present in both the original user message and `links_json`. The current behavior must be disclosed as conversation-linked metadata retention; it must not be described as URL-free or query-free logging.

**Approved policy:** the user approved redacting URL username/password credentials, query strings, and fragments from persisted source metadata in `messages.links_json`, while preserving scheme, host, and path for source display/navigation. The original user message in `messages.content` is intentionally unchanged, and the live response may still carry the original URL. Regression tests cover both metadata redaction and preservation of the original message. Existing rows are not retroactively migrated. Review export, deletion, backup, and retention behavior for both `messages.content` and `messages.links_json`; do not describe the overall conversation history as URL-secret-free.


## Privacy lifecycle review — deletion, export, and backups

- `DELETE /api/conversations/:id` deletes the caller-owned conversation. The schema declares `messages.conversation_id REFERENCES conversations(id) ON DELETE CASCADE`; therefore message rows, including `messages.content` and `messages.links_json`, are deleted with that conversation.
- `DELETE /api/conversations` deletes all conversations belonging to the authenticated user; the same foreign-key cascade applies to their messages and link metadata.
- A targeted regression test now exercises both delete routes with URL-bearing `messages.content` and `links_json`, and asserts that the associated conversation and message rows are gone. This is an application/database deletion test, not proof of backup erasure.
- The repository's export brief describes existing per-message browser-side `.txt` and `.md` downloads. The Worker route review did not identify a server-side full-account export endpoint. Browser exports are user-created copies and are outside the database deletion cascade.
- No account self-service deletion endpoint was identified in the reviewed Worker routes. The base schema does define user-level cascades for conversations and messages if the user row is deleted, but that alone is not an implemented account-deletion workflow.
- D1 backup/point-in-time recovery retention and deletion expiry are not configured in `wrangler.jsonc` or the repository migration/source reviewed here. Their actual account-level settings and lifecycle must be verified separately with the Cloudflare account owner; do not claim backup copies are immediately erased by a conversation delete.

**Disposition:** conversation-level deletion is implemented at the application/database layer and is covered by a targeted regression test. Persisted source metadata redaction is implemented for new writes, but it is not retroactive. Export copies, account deletion workflow, platform backups, retention duration, and any existing rows containing URL secrets remain open privacy-review items. This does not authorize proxy activation.

## Cloudflare Workers VPC architecture and read-only audit coverage

The Cloudflare architecture options are not interchangeable:

- A **VPC Service** routes to one pre-registered host and port. The host in the Worker `fetch()` URL supplies the HTTP `Host` header and HTTPS SNI, but it does not change the configured network destination. This is a suitable shape for reaching one dedicated egress-proxy origin, not for dynamically routing arbitrary user URLs by itself.
- A **VPC Network** grants broader reachability through a bound Tunnel, Mesh, or WAN on-ramp. The runtime URL/address selects the destination, and Cloudflare documents public-Internet egress through Gateway for applicable Mesh/WAN paths. That broader routing permission is not a substitute for the proxy's DNS validation, numeric peer pinning, TLS hostname verification, and per-redirect validation.
- The Worker must not receive a broad VPC Network binding merely to make URL reading work. Prefer a narrowly scoped VPC Service to a dedicated proxy endpoint, with the proxy itself enforcing the pinned transport and outbound policy.

Official references:
- VPC Services: https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/
- VPC Networks: https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/
- Workers VPC binding API: https://developers.cloudflare.com/workers-vpc/api/

The read-only Cloudflare audit workflow now includes a manually dispatchable path and checks:
- The deployed `ai-command-center` Worker settings endpoint for VPC Service/Network binding counts and whether a `LINK_FETCHER`-named binding exists. It emits counts only, not binding IDs, hosts, or secret values.
- The account's Workers VPC Connectivity Directory Services inventory.
- Existing Tunnel, Mesh, Magic Cloud Networking, CNI/interconnect, virtual-network, and Gateway policy inventories, with incomplete pagination reported as incomplete rather than silently treated as a complete inventory.

The Connectivity Directory Services inventory requires the Cloudflare **Connectivity Directory Read** role. The Worker settings check requires a Workers Scripts read-capable permission. Other Zero Trust and Magic WAN inventories retain their respective read-only scopes. The workflow remains read-only and does not create, edit, bind, or delete any Cloudflare resource.

Current repository evidence: `wrangler.jsonc` has neither `vpc_services` nor `vpc_networks`, and does not declare `LINK_FETCHER`. This is only source/configuration evidence. The deployed Worker settings endpoint and account inventory still need a successful live read; until then, account-wide binding and egress state remains unverified.

## Worker integration boundary — fail-closed source audit

A follow-up source audit traced the production chat path from `src/index.js` into `src/links.js`:

- Both user-supplied URLs and research-result page URLs call `readLinks` with `env.LINK_FETCHER || null`.
- `readLink` immediately returns a disabled/fail-closed result when no explicit fetcher function is supplied; it does not call the global `fetch` as a fallback.
- The repository's `wrangler.jsonc` does not declare a `LINK_FETCHER` binding. The only `fetch` calls found in the reviewed chat entry point are for Google OAuth signing-key retrieval and static asset handling, not arbitrary user URLs.
- `tests/links.test.js` includes a regression test asserting that the no-transport path never invokes global fetch.

**Scope limitation:** this is source/configuration evidence for the reviewed branch, not a live production binding inventory or proof that an external deployment has no out-of-band binding. The Node proxy prototype is not mounted or called by the Worker. Therefore the current application remains fail-closed; do not add a binding or enable URL reading until the private VPC route, authentication, privacy policy, and controlled egress proof are independently accepted.

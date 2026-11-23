# BOR AI: bounded optional verified-link transport

23 November 2026. This change is **source-only**. It does not switch on a DNS-pinned
egress proxy, alter an active Tavily Reader, mutate Cloudflare/D1, or call paid
providers. Production remains on its previous deployed Worker until a
separately reviewed deployment is explicitly authorized.

The optional `readLink` transport previously relied on per-hop AbortSignal
cooperation. A custom transport that ignored abort, an idle body stream, or a
ReadableStream whose cancellation never resolved could hang the request.
This patch applies a single capped eight-second deadline across all redirect
hops, headers and response body reads using Promise.race. Cancellation is
best-effort only; a broken cancel promise is never awaited.

Safety bounds remain in place: no generic network fetch without an injected
transport, URL scheme/private-IP guards, redirect checks on each hop, one-MB
body limit, supported content-types, and page text truncation. An invalid
timeout fails closed before contacting an endpoint.

These isolated tests are **not** a proof of peer-IP pinning, real TLS identity,
hosted Cloudflare operation or privacy/retention compliance. Do not merge
the old insecure direct-fetch path or enable a remote URL reader based on
these timing tests. The live managed Tavily Extract path uses a separate
bounded transport. Issues #156, #351, #382 and #385 remain open.

# Issue #156: API contracts, privacy evidence and runtime gates

Review date: 11 November 2026. This is an engineering source review, not an independent privacy approval or a legal retention policy.

## Cloudflare audit contract corrections

- CNI and interconnect list responses use top-level `items` and an optional numeric `next` cursor, not the usual `success/result` envelope. Follow cursors with a ten-page budget; a zero cursor is not silently treated as completion. Repeated or invalid cursors fail coverage.
- Directory Services accepts `page` and `per_page` (maximum 1000). Its `result_info` fields are optional. Follow reported total pages when supplied; otherwise request successive pages until an explicit empty terminal page. Reject inconsistent totals/page metadata and budget exhaustion. Empty authorized responses are distinct from denied access.
- `GET /accounts/{account_id}/magic/cloud/onramps` is the documented list path and requires Magic WAN Read or Write. The API reference labels it Closed Beta. The owner configured Cloudflare WAN Read on the audit token; the same credential now accesses the other WAN APIs. A remaining 404 is not sufficient to distinguish account entitlement, product availability or service-side routing. Retain it as unresolved, not empty or waived. Collect only numeric API error codes, never the raw body or account/network identifiers.

References verified on the review date:
- https://developers.cloudflare.com/api/resources/network_interconnects/subresources/cnis/methods/list/
- https://developers.cloudflare.com/api/resources/network_interconnects/subresources/interconnects/methods/list/
- https://developers.cloudflare.com/api/resources/connectivity/subresources/directory/subresources/services/methods/list/
- https://developers.cloudflare.com/api/resources/magic_cloud_networking/subresources/on_ramps/methods/list/

## Privacy source evidence

| Data / action | Source evidence | What this establishes / missing proof |
| --- | --- | --- |
| Original user text and assistant text | `src/index.js` history writes; `migrations/0001_auth_and_chat.sql` `messages.content` | Original content is retained and can contain complete URLs or secrets. Citation redaction does not redact message text. No new automatic message-expiry policy was implemented. |
| Citation metadata | `src/index.js` persisted-link sanitization; PR #176 regression coverage | Newly persisted URL metadata removes credentials, query and fragment. Historical rows were not migrated. |
| Conversation deletion | `handleConversationRoute` in `src/index.js`; messages/feedback foreign keys use `ON DELETE CASCADE` | Source scopes deletes to the authenticated owner. Deletion from provider backups or recovery history is not established by SQL cascade declarations. No real user data was deleted for this review. |
| Explicit memories | `src/memory.js` and `/api/memory` routes | Memory has separate scoped delete operations. Deleting chat history does not constitute deleting separately stored memories. |
| Export / print | `public/app.js` `exportConversationFile`, `downloadText`, `downloadMarkdown`, print helpers | User-controlled exports contain message content. Server deletion cannot revoke copies already downloaded or printed. |
| Proxy prototype | `tools/egress-proxy/pinned-transport.js` | Bounded in-memory request/response handling, authenticated fetch handler; no application persistence added by this prototype. This does not prove hosting-provider log or backup retention. |
| CI audit output | Cloudflare account-audit workflow and its regression tests | Resource names, destination hosts, tokens and raw error messages are suppressed. Only bounded aggregate counts and numeric error codes are reported. CI/provider artifact and log retention still needs an owner-approved policy. |

Independent reviewer must verify deployed D1 schema/foreign-key behavior with disposable synthetic data, history and memory ownership, export completeness/truncation behavior, provider access/logs, backup/recovery retention and deletion, historical citation cleanup, and the actual hosting jurisdiction. Preserve evidence and reviewer identity/date. Do not represent this source review as independent sign-off.

## Runtime evidence boundary

The Docker and Wrangler local harness under `tools/egress-proxy/containers` runs transport tests with container Internet disabled. It is explicitly local configuration. Its `/run` endpoint is a test trigger, not an authenticated deployed proxy. Do not deploy that local harness as a public service.

Hosted validation still needs an isolated authenticated harness, verified account entitlement and resource/cost limits, a synthetic origin with a valid certificate for the original hostname, and a controlled DNS fixture that returns both public and private answers. Record selected IP versus actual connected peer, original-host certificate verification, mixed A/AAAA and CNAME rejection, redirects, cancellation, limits and private-route behavior. Do not use user URLs/content or bind production `LINK_FETCHER` during this experiment. Hosting/provider logs, retention and credentials must be reviewed first.

## External DNS evidence

The opt-in test now includes DNS-only `example.com` controls and per-record failure-code counts for the rebinding fixture. It does not log resolver addresses or send external HTTP traffic. Control answers separate a generally broken resolver path from a fixture-specific failure. This diagnostic does not replace the requirement to observe both public and private fixture outcomes, and its mocked transport is not hosted TCP/TLS proof. Failures remain failures; do not substitute a DNS preflight for actual socket pinning.

Production URL reading remains fail-closed until all acceptance gates in #156 are evidenced.

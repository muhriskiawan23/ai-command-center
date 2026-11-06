# BOR AI Widget & Public API

Stage 29 adds a browser-embeddable chat widget and a small public chat API.

## Availability and database migration

The API-key endpoints require migration `0009_public_api_keys.sql`. The production deploy workflow deliberately does not apply D1 migrations automatically. Until the migration is explicitly approved and applied, key management and public chat return a clear database/migration error; existing BOR AI chat is unaffected.

## Create and manage an API key

Sign in to BOR AI, then use the authenticated same-origin endpoints:

- `GET /api/developer/keys` — list key metadata (never returns secrets).
- `POST /api/developer/keys` — create a key. JSON: `{"label":"Website utama","origins":["https://example.com"],"dailyLimit":100}`.
- `DELETE /api/developer/keys/{id}` — revoke a key immediately.

Creation returns the secret once. Store it securely while configuring the website. Only HTTPS origins are accepted, with localhost HTTP allowed for development. Up to five exact origins and 500 requests/day per key are allowed. Defaults are 100/day.

## Embed

Add this script to the website whose origin was allow-listed:

```html
<script async src="https://ai-command-center.muhriskiawan23.workers.dev/widget.js"
  data-api-key="borai_live_YOUR_KEY"
  data-api-url="https://ai-command-center.muhriskiawan23.workers.dev/api/public/chat"></script>
```

The widget is self-contained, uses a Shadow DOM, and sends only the typed message. It does not read page content, cookies, or other website data.

## Public chat API

`POST /api/public/chat`

Headers:
- `Authorization: Bearer borai_live_...`
- `Content-Type: application/json`
- Browser clients must send their normal `Origin` header.

Body:
```json
{"message":"Jelaskan layanan ini secara singkat."}
```

Optional `agent` may be any configured agent ID. Public API calls are single-turn and do not persist conversations. A model response may be retried once if its output is unusable. The daily per-key quota is atomic; failed model calls refund the consumed unit. Existing Cloudflare chat rate limiting also applies.

## Security and limits

- API keys are random high-entropy values; only SHA-256 hashes are stored.
- Keys are scoped to their owner and can be revoked.
- Exact origin allow-list, no wildcard origins.
- Origin checks are browser controls, not proof of server identity: a public website key can be copied from page source and non-browser clients can spoof Origin. Use a conservative daily quota and revoke exposed keys.
- Public widget requests do not inherit a user's private conversation history, Google session, files, memory, or saved chats.
- No paid API, third-party AI service, or new Cloudflare binding is added.

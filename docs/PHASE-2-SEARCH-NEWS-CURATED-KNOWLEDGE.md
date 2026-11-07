# Phase 2 — Search, News, and Curated Knowledge

## What ships in this milestone

- Explicit search/news intent detection in chat.
- Optional Brave Search API adapter for web and news results.
- First-party BOR AI knowledge retrieval from a small curated index based on the official project knowledge base.
- Deterministic source IDs, source links, publication dates, trust labels, and citation validation.
- Freshness guard: results with a parseable publication date older than 30 days are excluded from model context.
- Low-trust social/community hosts are excluded from model context.
- Search/news is disabled unless a server-side provider key exists. The chat tells the model and user that no live search occurred when the key is absent or the provider fails.

## Provider configuration

Set this secret in the Cloudflare Worker environment:

```sh
npx wrangler secret put BRAVE_SEARCH_API_KEY
```

The key is sent only in the `X-Subscription-Token` request header and is never sent to the browser, persisted in D1, added to prompts, or logged.

Optional Worker variables:

- `BRAVE_SEARCH_COUNTRY` — two-letter country code; defaults to `ID`.
- `BRAVE_SEARCH_LANG` — search language; defaults to `id`.

The integration uses Brave's `/web/search` endpoint for general search and `/news/search` for news. Search is triggered only when the user's message clearly asks for search, current information, or news. It is not run for ordinary chat. The existing chat rate limiter applies, and a configured external search consumes one additional daily usage unit.

A missing key is an intentional disabled state, not a fallback to model guesses. Provider errors, timeouts, and rate limits fail closed and are shown as unavailable sources.

## Provenance and trust policy

- Each source has a deterministic numeric ID used by inline citations.
- Only successful source IDs are allowed by the server-side citation validator.
- Markdown-linked numeric citations are validated too; invalid citation links are removed.
- Inline and fenced code examples are protected from citation cleanup.
- Search results are labelled external and unverified; a search result is not proof that a publisher's claim is true.
- Results without a parseable publication date are labelled as having no available date.
- Results older than 30 days are excluded from the model context.
- Social/community UGC hosts are excluded from model context in this initial policy.
- Search results and user-provided pages are untrusted data. Instructions inside retrieved content must never be followed.
- For each live search, BOR AI attempts to read up to three eligible result pages through the same SSRF-safe, redirect-validating link reader used for user-provided URLs. Each page excerpt is bounded to 8,000 characters.
- A successfully read page is included as untrusted evidence under the same source ID as its search result; the final redirect URL is retained for citation validation. If page reading fails or the three-page cap is reached, the model receives only the search-result title/snippet and an explicit `snippet_only` status. The UI shows whether page content was actually read.
- Retrieved page bodies are request-scoped and are not persisted in chat history; only source metadata and citations are retained.
- Only metadata and citations are saved with signed-in chat history; fetched page/search body text is not persisted.

## Curated knowledge

The first-party curated index currently contains selected project facts about BOR AI's identity, documented capabilities, privacy model, file support, official destinations, and development status. Its canonical source is:

https://github.com/muhriskiawan23/ai-command-center/blob/main/docs/BOR-AI-OFFICIAL-KNOWLEDGE-BASE.md

The index is intentionally small and local: it makes no external request and does not imply live browsing. When the canonical knowledge base changes, update the corresponding curated entries in `src/research.js` and their reviewed date, then add/update retrieval tests.

## Validation

Run:

```sh
npm test
npm run check
npm run preview
```

Live provider behaviour is tested with a stubbed fetcher. A successful test does not prove the production provider key is configured or that the live provider account has quota. After setting the secret, verify one general-search request and one news request in the preview environment before announcing the feature as live.

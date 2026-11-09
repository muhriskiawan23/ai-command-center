import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchContext, detectResearchMode, retrieveCuratedKnowledge, searchExternal } from "../src/research.js";

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("detects explicit search and news intent without treating ordinary chat as live search", () => {
  assert.equal(detectResearchMode("Cari berita terbaru tentang ekonomi Indonesia"), "news");
  assert.equal(detectResearchMode("Search current AI regulation today"), "web");
  assert.equal(detectResearchMode("Jelaskan konsep manajemen risiko"), null);
  assert.equal(detectResearchMode("Ringkas https://contoh.id/berita/beras"), null);
});

test("curated retrieval returns only relevant first-party passages with stable provenance", () => {
  const result = retrieveCuratedKnowledge("Bagaimana BOR AI menyimpan privacy dan conversation history?", 4);
  assert.ok(result.context.includes("<curated_document"));
  assert.ok(result.context.includes("untrusted") === false);
  assert.ok(result.sources.length > 0);
  assert.equal(result.sources[0].sourceId, 4);
  assert.equal(result.sources[0].trust, "official-curated");
  assert.match(result.sources[0].url, /github\.com\/muhriskiawan23/);
  assert.deepEqual(retrieveCuratedKnowledge("xyzzy qwerty", 1), { context: "", sources: [] });
});

test("search is explicitly inactive when no provider secret is configured", async () => {
  const result = await searchExternal("berita terbaru", "news", {});
  assert.equal(result.configured, false);
  const context = buildResearchContext(result, 7);
  assert.match(context.context, /No live external search was performed/);
  assert.equal(context.sources[0].ok, false);
  assert.equal(context.sources[0].sourceId, 7);
});

test("Brave API key is sent only in a header and fresh results receive provenance", async () => {
  let requested;
  const result = await searchExternal("berita terbaru ekonomi", "news", { BRAVE_SEARCH_API_KEY: "secret-test" }, {
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetcher: async (url, init) => {
      requested = { url, init };
      return jsonResponse({ results: [{
        title: "Judul berita",
        url: "https://publisher.example/news/1",
        description: "Ringkasan faktual.",
        page_age: "2026-11-06T10:00:00Z"
      }] });
    }
  });
  assert.equal(result.configured, true);
  assert.equal(result.provider, "brave");
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].publishedAt, "2026-11-06T10:00:00.000Z");
  assert.match(requested.url, /\/news\/search/);
  assert.ok(!requested.url.includes("secret-test"));
  assert.equal(requested.init.headers["X-Subscription-Token"], "secret-test");
  const context = buildResearchContext(result, 2);
  assert.match(context.context, /source_id="2"/);
  assert.equal(context.sources[0].sourceId, 2);
});

test("search results with credentials, custom ports, or private hosts are rejected before citation or page reading", async () => {
  const result = await searchExternal("security test", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetcher: async () => jsonResponse({ results: [
      { title: "Credentials", url: "https://user:pass@publisher.example/article", description: "Unsafe URL", page_age: "2026-11-06T00:00:00Z" },
      { title: "Custom port", url: "https://publisher.example:8443/article", description: "Unsafe port", page_age: "2026-11-06T00:00:00Z" },
      { title: "Private host", url: "https://127.0.0.1/admin", description: "Private URL", page_age: "2026-11-06T00:00:00Z" }
    ] })
  });
  assert.equal(result.results.length, 3);
  assert.ok(result.results.every((item) => item.ok === false));
  assert.ok(result.results.every((item) => item.url === undefined));
  assert.ok(result.results.every((item) => item.reason));
});

test("stale and social/UGC results are excluded from model context", async () => {
  const result = await searchExternal("latest topic", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetcher: async () => jsonResponse({ results: [
      { title: "Old article", url: "https://publisher.example/old", description: "Old data", page_age: "2026-09-01T00:00:00Z" },
      { title: "Social post", url: "https://reddit.com/r/example", description: "User post", page_age: "2026-11-06T00:00:00Z" }
    ] })
  });
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].stale, true);
  assert.equal(result.results[1].ok, false);
  const context = buildResearchContext(result, 1);
  assert.match(context.context, /status="excluded"/);
  assert.doesNotMatch(context.context, /Old data|User post/);
  assert.ok(context.sources.every((source) => source.ok === false));
});

test("oversized chunked search responses are cancelled before the full body is buffered", async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new Uint8Array(128_000).fill(97);
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
      if (pulls > 10) controller.close();
    },
    cancel() { cancelled = true; }
  });
  const result = await searchExternal("bounded response test", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async () => new Response(body, { headers: { "content-type": "application/json" } })
  });
  assert.equal(result.reason, "provider_response_too_large");
  assert.equal(result.results.length, 0);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4, `stream pulled ${pulls} chunks before cancellation`);
});

test("provider errors and timeouts fail closed with no invented result", async () => {
  const limited = await searchExternal("news", "news", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async () => new Response("{}", { status: 429 })
  });
  assert.equal(limited.reason, "provider_rate_limited");
  const context = buildResearchContext(limited, 1);
  assert.match(context.context, /No current external facts are available/);
  const timeout = await searchExternal("news", "news", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
  });
  assert.equal(timeout.reason, "provider_timeout");
});


test("curated capability index reflects bounded DOCX support and its current update date", () => {
  const result = retrieveCuratedKnowledge("BOR AI DOCX Word support", 1);
  assert.ok(result.context.includes("Word DOCX paragraphs"));
  assert.ok(result.context.includes('updated_at="2026-11-09"'));
});

test("provider error responses are cancelled without buffering their bodies", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("provider error")); },
    cancel() { cancelled = true; }
  });
  const result = await searchExternal("news", "news", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async () => new Response(body, { status: 429, headers: { "content-type": "application/json" } })
  });
  assert.equal(result.reason, "provider_rate_limited");
  assert.equal(cancelled, true);
});


test("provider-neutral search adapter rejects unknown providers without making network requests", async () => {
  let called = false;
  const result = await searchExternal("latest news", "news", { SEARCH_PROVIDER: "unknown" }, {
    fetcher: async () => { called = true; return jsonResponse({ results: [] }); }
  });
  assert.equal(result.configured, false);
  assert.equal(result.provider, "unknown");
  assert.equal(result.reason, "provider_unsupported");
  assert.deepEqual(result.results, []);
  assert.equal(called, false);
});

test("provider-neutral search adapter defaults to Brave and returns the normalized provider identifier", async () => {
  const result = await searchExternal("current technology", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async () => jsonResponse({ results: [{
      title: "Current technology",
      url: "https://publisher.example/current",
      description: "A current report",
      page_age: "2026-11-08T10:00:00Z"
    }] })
  });
  assert.equal(result.provider, "brave");
  assert.equal(result.configured, true);
  assert.equal(result.results[0].ok, true);
  assert.match(buildResearchContext(result).context, /Brave Search API/);
});

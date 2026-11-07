import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchContext, detectResearchMode, readResearchPages, retrieveCuratedKnowledge, searchExternal } from "../src/research.js";

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
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].publishedAt, "2026-11-06T10:00:00.000Z");
  assert.match(requested.url, /\/news\/search/);
  assert.ok(!requested.url.includes("secret-test"));
  assert.equal(requested.init.headers["X-Subscription-Token"], "secret-test");
  const context = buildResearchContext(result, 2);
  assert.match(context.context, /source_id="2"/);
  assert.equal(context.sources[0].sourceId, 2);
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


test("research pages use the SSRF-safe reader and stable source IDs after search results", async () => {
  const requested = [];
  const result = await readResearchPages({ results: [
    { ok: true, url: "https://publisher.example/article" },
    { ok: false, url: "https://reddit.com/r/example" },
    { ok: true, url: "http://127.0.0.1/private" }
  ] }, 8, {
    fetcher: async (url) => {
      requested.push(url);
      return new Response("<html><head><title>Publisher report</title></head><body><p>This is a sufficiently long publisher article excerpt for research context.</p></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  });
  assert.deepEqual(requested, ["https://publisher.example/article"]);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].sourceId, 8);
  assert.equal(result.sources[0].ok, true);
  assert.equal(result.sources[1].sourceId, 9);
  assert.equal(result.sources[1].ok, false);
  assert.match(result.context, /<web_page source_id="8"/);
  assert.match(result.context, /Publisher report/);
});

test("research page retrieval is capped at the link reader limit", async () => {
  const requested = [];
  await readResearchPages({ results: [1, 2, 3, 4, 5].map((n) => ({ ok: true, url: "https://publisher.example/" + n })) }, 1, {
    fetcher: async (url) => {
      requested.push(url);
      return new Response("<html><body><p>This is a sufficiently long article body for the reader limit test.</p></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  });
  assert.equal(requested.length, 3);
});

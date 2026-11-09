import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchContext, detectResearchMode, isSearchProviderConfigured, retrieveCuratedKnowledge, searchExternal } from "../src/research.js";

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


test("provider-neutral search adapter rejects unknown and prototype-like providers without network requests", async () => {
  for (const provider of ["unknown", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
    let called = false;
    const result = await searchExternal("latest news", "news", { SEARCH_PROVIDER: provider }, {
      fetcher: async () => { called = true; return jsonResponse({ results: [] }); }
    });
    assert.equal(result.configured, false);
    assert.equal(result.provider, provider.toLowerCase());
    assert.equal(result.reason, "provider_unsupported");
    assert.deepEqual(result.results, []);
    assert.equal(called, false);
    const context = buildResearchContext(result, 1);
    assert.match(context.sources[0].reason, /belum didukung/);
  }
});

test("Tavily is selected when its Worker secret is configured and maps fresh search/news results safely", async () => {
  let requested;
  const result = await searchExternal("berita ekonomi Indonesia", "news", { TAVILY_API_KEY: "tavily-test-secret" }, {
    now: Date.parse("2026-11-08T00:00:00Z"),
    fetcher: async (url, init) => {
      requested = { url, init, body: JSON.parse(init.body) };
      return jsonResponse({ results: [{
        title: "Berita ekonomi",
        url: "https://publisher.example/economy?utm_source=feed#top",
        content: "Ringkasan berita ekonomi terbaru.",
        published_date: "2026-11-07T10:00:00Z",
        score: 0.91
      }] });
    }
  });
  assert.equal(result.provider, "tavily");
  assert.equal(result.configured, true);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].url, "https://publisher.example/economy");
  assert.equal(result.results[0].description, "Ringkasan berita ekonomi terbaru.");
  assert.equal(result.results[0].publishedAt, "2026-11-07T10:00:00.000Z");
  assert.equal(result.results[0].sourceType, "news");
  assert.equal(requested.url, "https://api.tavily.com/search");
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.headers.Authorization, "Bearer tavily-test-secret");
  assert.equal(requested.body.query, "berita ekonomi Indonesia");
  assert.equal(requested.body.topic, "news");
  assert.equal(requested.body.search_depth, "basic");
  assert.equal(requested.body.max_results, 10);
  assert.equal(requested.body.include_answer, false);
  assert.equal(requested.body.include_raw_content, false);
  assert.equal(requested.body.api_key, undefined);
  assert.match(buildResearchContext(result).context, /Tavily Search API/);
});

test("Tavily auth, quota and malformed responses fail closed without exposing provider details", async () => {
  const auth = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => new Response("unauthorized", { status: 401 })
  });
  assert.equal(auth.reason, "provider_auth_error");
  const quota = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => new Response("quota", { status: 432 })
  });
  assert.equal(quota.reason, "provider_rate_limited");
  const context = buildResearchContext(quota);
  assert.match(context.context, /No current external facts are available/);
  assert.doesNotMatch(context.context, /secret|quota/i);
  const invalid = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => new Response("not-json", { headers: { "content-type": "text/plain" } })
  });
  assert.equal(invalid.reason, "provider_invalid_response");
});

test("Tavily results pass the same URL, freshness, deduplication and source-diversity gates", async () => {
  const result = await searchExternal("safe search", "web", { TAVILY_API_KEY: "secret" }, {
    now: Date.parse("2026-11-08T00:00:00Z"),
    fetcher: async () => jsonResponse({ results: [
      { title: "Invalid", url: "https://127.0.0.1/admin", content: "Private", published_date: "2026-11-07T00:00:00Z" },
      { title: "Old", url: "https://old.example/story", content: "Stale", published_date: "2026-09-01T00:00:00Z" },
      { title: "First", url: "https://publisher.example/story?utm_source=x", content: "Fresh", published_date: "2026-11-07T00:00:00Z" },
      { title: "Duplicate", url: "https://publisher.example/story", content: "Duplicate", published_date: "2026-11-07T00:00:00Z" },
      { title: "Second host", url: "https://another.example/story", content: "Fresh other", published_date: "2026-11-07T00:00:00Z" }
    ] })
  });
  assert.equal(result.results.find((item) => item.title === "Invalid").ok, false);
  assert.equal(result.results.find((item) => item.title === "Old").stale, true);
  assert.equal(result.results.some((item) => item.title === "Duplicate"), false);
  assert.equal(result.results.find((item) => item.title === "First").ok, true);
  assert.equal(result.results.find((item) => item.title === "Second host").ok, true);
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


test("unsupported provider reports an accurate fail-closed status without implying the Brave key is missing", async () => {
  const result = await searchExternal("latest news", "news", { SEARCH_PROVIDER: "other" });
  const context = buildResearchContext(result, 9);
  assert.match(context.context, /provider_unsupported/);
  assert.match(context.sources[0].reason, /belum didukung/);
  assert.doesNotMatch(context.sources[0].reason, /BRAVE_SEARCH_API_KEY/);
});


test("provider readiness is resolved by the selected adapter instead of a Brave-specific quota check", () => {
  assert.equal(isSearchProviderConfigured({}), false);
  assert.equal(isSearchProviderConfigured({ TAVILY_API_KEY: "secret" }), true);
  assert.equal(isSearchProviderConfigured({ SEARCH_PROVIDER: "brave", TAVILY_API_KEY: "secret" }), false);
  assert.equal(isSearchProviderConfigured({ BRAVE_SEARCH_API_KEY: "secret" }), true);
  assert.equal(isSearchProviderConfigured({ SEARCH_PROVIDER: "unknown", BRAVE_SEARCH_API_KEY: "secret" }), false);
  assert.equal(isSearchProviderConfigured({ SEARCH_PROVIDER: "__proto__", BRAVE_SEARCH_API_KEY: "secret" }), false);
});


test("search canonicalizes tracking variants and removes duplicate URLs before assigning sources", async () => {
  let requested;
  const result = await searchExternal("research duplicate URLs", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetcher: async (url) => {
      requested = new URL(url);
      return jsonResponse({ results: [
        { title: "Primary", url: "https://publisher.example/story?utm_source=feed&id=7#top", page_age: "2026-11-06T00:00:00Z" },
        { title: "Duplicate tracking variant", url: "https://publisher.example/story?id=7&utm_campaign=other", page_age: "2026-11-06T00:00:00Z" },
        { title: "Second article", url: "https://publisher.example/second", page_age: "2026-11-06T00:00:00Z" }
      ] });
    }
  });
  assert.equal(requested.searchParams.get("count"), "10");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].url, "https://publisher.example/story?id=7");
  assert.equal(result.results[1].url, "https://publisher.example/second");
  assert.ok(result.results.every((item) => item.ok));
});

test("early excluded candidates do not crowd out later usable search results", async () => {
  const result = await searchExternal("candidate selection", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetcher: async () => jsonResponse({ results: [
      ...Array.from({ length: 5 }, (_, index) => ({
        title: `Rejected ${index + 1}`,
        url: `http://insecure.example/${index + 1}`,
        description: "Must not displace a valid source",
        page_age: "2026-11-06T00:00:00Z"
      })),
      {
        title: "Usable sixth candidate",
        url: "https://reliable.example/article",
        description: "A fresh usable source",
        page_age: "2026-11-06T00:00:00Z"
      }
    ] })
  });
  assert.equal(result.results.length, 5);
  assert.equal(result.results[0].title, "Usable sixth candidate");
  assert.equal(result.results.filter((item) => item.ok).length, 1);
  assert.equal(result.results[0].url, "https://reliable.example/article");
});

test("search limits usable results to two per hostname while continuing to diversify candidates", async () => {
  const result = await searchExternal("diverse search results", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    now: Date.parse("2026-11-07T00:00:00Z"),
    fetcher: async () => jsonResponse({ results: [
      { title: "A1", url: "https://publisher.example/a1", page_age: "2026-11-06T00:00:00Z" },
      { title: "A2", url: "https://publisher.example/a2", page_age: "2026-11-06T00:00:00Z" },
      { title: "A3", url: "https://publisher.example/a3", page_age: "2026-11-06T00:00:00Z" },
      { title: "B1", url: "https://another.example/b1", page_age: "2026-11-06T00:00:00Z" }
    ] })
  });
  assert.equal(result.results.length, 4);
  assert.equal(result.results.filter((item) => item.ok && item.host === "publisher.example").length, 2);
  assert.equal(result.results.find((item) => item.title === "A3").trust, "limited-source-diversity");
  assert.equal(result.results.find((item) => item.title === "B1").ok, true);
  assert.equal(buildResearchContext(result).sources.filter((source) => source.ok).length, 3);
});

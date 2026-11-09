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
  assert.equal(requested.init.redirect, "manual");
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
  let rateLimitCalls = 0;
  const limited = await searchExternal("news", "news", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async () => {
      rateLimitCalls += 1;
      return new Response("{}", { status: 429 });
    }
  });
  assert.equal(limited.reason, "provider_rate_limited");
  assert.equal(rateLimitCalls, 1, "rate limits must not be retried");
  assert.equal(limited.diagnostics.attempts, 1);
  const context = buildResearchContext(limited, 1);
  assert.match(context.context, /No current external facts are available/);
  let timeoutCalls = 0;
  const timeout = await searchExternal("news", "news", { BRAVE_SEARCH_API_KEY: "secret" }, {
    fetcher: async (_url, { signal }) => {
      timeoutCalls += 1;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
  });
  assert.equal(timeout.reason, "provider_timeout");
  assert.equal(timeoutCalls, 1, "an exhausted shared timeout budget must not be retried");
  assert.equal(timeout.diagnostics.attempts, 1);
});

test("Tavily retries one transient upstream status within the shared timeout budget", async () => {
  let calls = 0;
  const result = await searchExternal("bounded retry test", "web", { TAVILY_API_KEY: "secret" }, {
    now: Date.parse("2026-11-09T00:00:00Z"),
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return new Response("temporarily unavailable", { status: 503 });
      return jsonResponse({ results: [{
        title: "Recovered result",
        url: "https://publisher.example/recovered",
        content: "Fresh result after a transient provider error.",
        published_date: "2026-11-09T00:00:00Z"
      }] });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.diagnostics.attempts, 2);
});

test("provider retry does not repeat aborts or non-network programming errors", async () => {
  for (const failure of [
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    new Error("unexpected adapter bug")
  ]) {
    let calls = 0;
    const result = await searchExternal("retry classification", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
      fetcher: async () => {
        calls += 1;
        throw failure;
      }
    });
    assert.equal(calls, 1);
    assert.equal(result.reason, "provider_unavailable");
    assert.equal(result.diagnostics.attempts, 1);
  }
});

test("Brave retries one transient network failure and records attempts", async () => {
  let calls = 0;
  const result = await searchExternal("bounded retry test", "web", { BRAVE_SEARCH_API_KEY: "secret" }, {
    now: Date.parse("2026-11-09T00:00:00Z"),
    fetcher: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("temporary network failure");
      return jsonResponse({ results: [{
        title: "Recovered result",
        url: "https://publisher.example/recovered",
        description: "Fresh result after a transient network failure.",
        page_age: "2026-11-09T00:00:00Z"
      }] });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.diagnostics.attempts, 2);
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
  assert.equal(requested.init.redirect, "manual");
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

test("search providers use Workers-compatible manual redirects and reject 3xx without following", async () => {
  for (const env of [
    { BRAVE_SEARCH_API_KEY: "brave-test" },
    { TAVILY_API_KEY: "tavily-test" }
  ]) {
    let calls = 0;
    let redirectMode;
    const result = await searchExternal("redirect safety test", "web", env, {
      fetcher: async (_url, init) => {
        calls += 1;
        redirectMode = init.redirect;
        return new Response("", { status: 302, headers: { location: "https://untrusted.example/collect" } });
      }
    });
    assert.equal(redirectMode, "manual");
    assert.equal(calls, 1, "the redirect destination must never be fetched");
    assert.equal(result.reason, "provider_redirect_rejected");
    assert.equal(result.diagnostics.httpStatus, 302);
    assert.deepEqual(result.results, []);
  }
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


test("provider readiness ignores whitespace-only secrets and selects a usable fallback provider", async () => {
  assert.equal(isSearchProviderConfigured({ TAVILY_API_KEY: "   " }), false);
  assert.equal(isSearchProviderConfigured({ BRAVE_SEARCH_API_KEY: "\n\t" }), false);
  assert.equal(isSearchProviderConfigured({ TAVILY_API_KEY: "  ", BRAVE_SEARCH_API_KEY: "brave-valid" }), true);

  const result = await searchExternal("current technology", "web", {
    TAVILY_API_KEY: "  ",
    BRAVE_SEARCH_API_KEY: "brave-valid"
  }, {
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


test("Tavily exposes safe HTTP diagnostics without including provider response bodies", async () => {
  const result = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => new Response("private provider payload", { status: 400 })
  });
  assert.equal(result.reason, "provider_request_rejected");
  assert.deepEqual(result.diagnostics, { httpStatus: 400, candidateCount: 0, usableCount: 0, attempts: 1 });
  const context = buildResearchContext({ ...result, provider: "tavily" });
  assert.match(context.sources[0].reason, /HTTP 400/);
  assert.doesNotMatch(context.sources[0].reason, /private provider payload|secret/);
});

test("Tavily distinguishes empty responses from candidates rejected by source validation", async () => {
  const empty = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => jsonResponse({ results: [] })
  });
  assert.equal(empty.reason, "provider_empty_results");
  assert.equal(empty.diagnostics.candidateCount, 0);

  const rejected = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    now: Date.parse("2026-11-08T00:00:00Z"),
    fetcher: async () => jsonResponse({ results: [
      { title: "Old result", url: "https://publisher.example/old", content: "Old", published_date: "2026-09-01T00:00:00Z" },
      { title: "Unsafe result", url: "http://publisher.example/insecure", content: "Unsafe", published_date: "2026-11-07T00:00:00Z" }
    ] })
  });
  assert.equal(rejected.reason, "provider_no_usable_results");
  assert.equal(rejected.diagnostics.candidateCount, 2);
  assert.equal(rejected.diagnostics.usableCount, 0);
  assert.deepEqual(rejected.diagnostics.exclusionCounts, { stale: 1, invalid_or_low_trust: 1 });
  const context = buildResearchContext({ ...rejected, provider: "tavily" });
  assert.match(context.sources[0].reason, /stale=1/);
  assert.match(context.sources[0].reason, /invalid_or_low_trust=1/);
});

test("search diagnostics identify the selected provider instead of hard-coding Tavily", () => {
  const context = buildResearchContext({
    configured: true,
    provider: "brave",
    mode: "web",
    results: [],
    reason: "provider_rate_limited"
  });
  assert.match(context.sources[0].reason, /Brave Search API/);
  assert.doesNotMatch(context.sources[0].reason, /Tavily/);
});

test("Tavily rejects a successful HTTP response with an invalid result schema", async () => {
  const result = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => jsonResponse({ unexpected: [] })
  });
  assert.equal(result.reason, "provider_invalid_response");
  assert.deepEqual(result.diagnostics, {
    httpStatus: 200, candidateCount: 0, usableCount: 0, failureStage: "payload_schema", attempts: 1
  });
  const context = buildResearchContext(result);
  assert.match(context.sources[0].reason, /invalid_response/);
  assert.doesNotMatch(context.sources[0].reason, /empty results/);
});


test("Tavily transport diagnostics expose only allowlisted cause codes", async () => {
  const classified = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => {
      const error = new TypeError("do not expose this transport message");
      error.cause = { code: "ECONNRESET", message: "contains private details" };
      throw error;
    }
  });
  assert.equal(classified.diagnostics.causeCode, "ECONNRESET");
  const context = buildResearchContext(classified);
  assert.equal(context.sources[0].diagnostics.causeCode, "ECONNRESET");
  assert.doesNotMatch(context.context + JSON.stringify(context.sources), /private details|transport message|secret/);

  const unknown = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => {
      const error = new TypeError("do not expose this transport message");
      error.cause = { code: "PRIVATE_INTERNAL_VALUE", message: "private" };
      throw error;
    }
  });
  assert.equal(unknown.diagnostics.causeCode, undefined);
  assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE_INTERNAL_VALUE|private|secret/);
});

test("Tavily network failures expose only a safe failure stage and error class", async () => {
  const result = await searchExternal("query", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => { throw new TypeError("sensitive transport details"); }
  });
  assert.equal(result.reason, "provider_unavailable");
  assert.deepEqual(result.diagnostics, {
    failureStage: "network_request",
    attempts: 2,
    errorName: "TypeError"
  });
  const context = buildResearchContext(result);
  assert.deepEqual(context.sources[0].diagnostics, {
    failureStage: "network_request",
    errorName: "TypeError"
  });
  assert.doesNotMatch(context.context + JSON.stringify(context.sources), /sensitive transport details|secret/);
});


test("Tavily trims pasted secret whitespace before building the Authorization header", async () => {
  let authorization;
  const result = await searchExternal("trim secret test", "web", { TAVILY_API_KEY: "  tvly-test-secret\n" }, {
    fetcher: async (_url, init) => {
      authorization = init.headers.Authorization;
      return jsonResponse({ results: [] });
    }
  });
  assert.equal(result.provider, "tavily");
  assert.equal(authorization, "Bearer tvly-test-secret");
});

test("Tavily transport diagnostics find allowlisted codes in nested causes only", async () => {
  const result = await searchExternal("nested cause test", "web", { TAVILY_API_KEY: "secret" }, {
    fetcher: async () => {
      const error = new TypeError("private transport detail");
      error.cause = { cause: { code: "UND_ERR_CONNECT_TIMEOUT", message: "private nested detail" } };
      throw error;
    }
  });
  assert.equal(result.reason, "provider_unavailable");
  assert.equal(result.diagnostics.causeCode, "UND_ERR_CONNECT_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(result), /private transport detail|private nested detail|secret/);
});

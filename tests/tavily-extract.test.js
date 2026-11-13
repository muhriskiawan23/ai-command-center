import test from "node:test";
import assert from "node:assert/strict";
import { extractWithTavily, reserveTavilyExtractBudget } from "../src/tavily-extract.js";
function testEnv(key = "test", limit = 30) {
  let used = 0;
  return { TAVILY_API_KEY: key, TAVILY_EXTRACT_DAILY_URL_LIMIT: limit, DB: {
    prepare() { return { bind(_day, _subject, units, _timestamp, ceiling) { return {
      async first() { if (used + units > ceiling) return null; used += units; return { units: used }; }
    }; } }; }
  } };
}


test("Tavily Extract refuses private URLs before contacting provider", async () => {
  let calls = 0;
  const result = await extractWithTavily(["http://127.0.0.1/admin"], testEnv(), {
    fetcher: async () => { calls++; throw Error("must not fetch"); }
  });
  assert.equal(calls, 0);
  assert.equal(result[0].ok, false);
});

test("Tavily Extract returns bounded untrusted page text", async () => {
  let endpoint;
  const fetcher = async (url, options) => {
    endpoint = url;
    assert.equal(options.redirect, "manual");
    assert.deepEqual(JSON.parse(options.body).urls, ["https://example.com/article"]);
    return new Response(JSON.stringify({ results: [{ url: "https://example.com/article", raw_content: "A".repeat(17000) }] }), { headers: { "content-type": "application/json" } });
  };
  const result = await extractWithTavily(["https://example.com/article"], testEnv(), { fetcher });
  assert.equal(endpoint, "https://api.tavily.com/extract");
  assert.equal(result[0].ok, true);
  assert.equal(result[0].text.length, 16000);
  assert.equal(result[0].truncated, true);
});

test("Tavily Extract fails closed without secret", async () => {
  const result = await extractWithTavily(["https://example.com"], {});
  assert.equal(result[0].ok, false);
});

test("Tavily Extract preserves blocked URL reason without API key", async () => {
  const result = await extractWithTavily(["http://127.0.0.1/admin"], {});
  assert.equal(result[0].ok, false);
  assert.match(result[0].reason, /non-publik/);
});

test("Tavily Extract never accepts a substituted URL returned by provider", async () => {
  const fetcher = async () => new Response(JSON.stringify({
    results: [{ url: "https://other.example.net/secret", raw_content: "X".repeat(100) }]
  }), { headers: { "content-type": "application/json" } });
  const result = await extractWithTavily(["https://example.com/article"], testEnv(), { fetcher });
  assert.equal(result[0].ok, false);
});

test("Tavily Extract rejects oversized responses", async () => {
  const fetcher = async () => new Response("X".repeat(1000001), { headers: { "content-type": "application/json" } });
  const result = await extractWithTavily(["https://example.com/article"], testEnv(), { fetcher });
  assert.equal(result[0].ok, false);
});

test("Tavily adapter is feature-flagged in both chat URL and research paths", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const occurrences = source.match(/env\.URL_READER_ENABLED === "true" && env\.URL_READER_PROVIDER === "tavily"/g) || [];
  assert.equal(occurrences.length, 2);
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"URL_READER_ENABLED": "false"/);
});

test("Tavily Extract deduplicates repeated URLs before charging provider", async () => {
  let calls = 0;
  const fetcher = async (_endpoint, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body).urls, ["https://example.com/a"]);
    return new Response(JSON.stringify({
      results: [{ url: "https://example.com/a", raw_content: "A".repeat(100) }]
    }), { headers: { "content-type": "application/json" } });
  };
  const result = await extractWithTavily(["https://example.com/a", "https://example.com/a"], testEnv(), { fetcher });
  assert.equal(calls, 1);
  assert.equal(result.length, 2);
  assert.ok(result.every(x => x.ok));
});

test("Tavily Extract fails closed on provider redirect", async () => {
  const fetcher = async (_url, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  };
  const result = await extractWithTavily(["https://example.com/article"], testEnv(), { fetcher });
  assert.equal(result[0].ok, false);
});

test("Tavily Extract fails closed on provider error without exposing API key", async () => {
  const secret = "super-private-tavily-key";
  const fetcher = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer " + secret);
    return new Response(JSON.stringify({ error: secret }), { status: 429, headers: { "content-type": "application/json" } });
  };
  const result = await extractWithTavily(["https://example.com/article"], testEnv(secret), { fetcher });
  assert.equal(result[0].ok, false);
  assert.doesNotMatch(JSON.stringify(result), /super-private-tavily-key/);
});

test("Tavily Extract does not send private URLs in a mixed batch", async () => {
  const fetcher = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).urls, ["https://example.com/article"]);
    return new Response(JSON.stringify({ results: [{ url: "https://example.com/article", raw_content: "X".repeat(100) }] }), { headers: { "content-type": "application/json" } });
  };
  const result = await extractWithTavily(["http://127.0.0.1/admin", "https://example.com/article"], testEnv(), { fetcher });
  assert.equal(result[0].ok, false);
  assert.equal(result[1].ok, true);
});

test("Tavily budget rejects requests when DB is unavailable", async () => {
  assert.equal(await reserveTavilyExtractBudget({}, 1), false);
  let calls = 0;
  const result = await extractWithTavily(["https://example.com/article"], { TAVILY_API_KEY: "test" }, { fetcher: async () => { calls++; throw Error("must not call"); } });
  assert.equal(calls, 0);
  assert.equal(result[0].ok, false);
});

test("Tavily global budget atomically rejects requests above the daily limit", async () => {
  const env = testEnv("test", 2);
  assert.equal(await reserveTavilyExtractBudget(env, 2), true);
  assert.equal(await reserveTavilyExtractBudget(env, 1), false);
});

test("Tavily Extract rejects URLs containing credential-like query parameters", async () => {
  let calls = 0;
  const result = await extractWithTavily(["https://example.com/callback?access_token=private"], testEnv(), {
    fetcher: async () => { calls++; throw Error("must not call"); }
  });
  assert.equal(calls, 0);
  assert.equal(result[0].ok, false);
  assert.match(result[0].reason, /sensitif/);
});

test("Tavily Extract strips URL fragments before sending them to provider", async () => {
  const fetcher = async (_endpoint, options) => {
    assert.deepEqual(JSON.parse(options.body).urls, ["https://example.com/article"]);
    return new Response(JSON.stringify({ results: [{ url: "https://example.com/article", raw_content: "A".repeat(100) }] }), { headers: { "content-type": "application/json" } });
  };
  const result = await extractWithTavily(["https://example.com/article#private-fragment"], testEnv(), { fetcher });
  assert.equal(result[0].ok, true);
});

test("URL reader disabled flag prevents both legacy and Tavily reads", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /if \(found\.urls\.length && env\.URL_READER_ENABLED === "true"\)/);
  assert.match(source, /if \(pageCandidates\.length && env\.URL_READER_ENABLED === "true"\)/);
});

test("Tavily budget explicit zero and malformed values block provider spending", async () => {
  for (const limit of [0, -1, "invalid", "", 10001]) {
    const env = testEnv("test", limit);
    let calls = 0;
    const result = await extractWithTavily(["https://example.com/article"], env, {
      fetcher: async () => { calls++; throw Error("must not call provider"); }
    });
    assert.equal(calls, 0, "limit " + String(limit));
    assert.equal(result[0].ok, false);
  }
});

test("Tavily rejects embedded URL credentials before provider request", async () => {
  let calls = 0;
  const result = await extractWithTavily(["https://alice:password@example.com/article"], testEnv(), {
    fetcher: async () => { calls++; throw Error("must not call"); }
  });
  assert.equal(calls, 0);
  assert.equal(result[0].ok, false);
});

test("Tavily blocks camelCase and signed URL credential query keys", async () => {
  for (const key of ["authToken", "accessToken", "clientSecret", "apiKey", "X-Amz-Signature", "jwt", "bearer"]) {
    let calls = 0;
    const result = await extractWithTavily(["https://example.com/article?" + key + "=private"], testEnv(), {
      fetcher: async () => { calls++; throw Error("must not call"); }
    });
    assert.equal(calls, 0, key);
    assert.equal(result[0].ok, false, key);
  }
});

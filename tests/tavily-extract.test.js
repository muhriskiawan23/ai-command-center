import test from "node:test";
import assert from "node:assert/strict";
import { extractWithTavily } from "../src/tavily-extract.js";

test("Tavily Extract refuses private URLs before contacting provider", async () => {
  let calls = 0;
  const result = await extractWithTavily(["http://127.0.0.1/admin"], { TAVILY_API_KEY: "test" }, {
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
  const result = await extractWithTavily(["https://example.com/article"], { TAVILY_API_KEY: "test" }, { fetcher });
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
  const result = await extractWithTavily(["https://example.com/article"], { TAVILY_API_KEY: "test" }, { fetcher });
  assert.equal(result[0].ok, false);
});

test("Tavily Extract rejects oversized responses", async () => {
  const fetcher = async () => new Response("X".repeat(1000001), { headers: { "content-type": "application/json" } });
  const result = await extractWithTavily(["https://example.com/article"], { TAVILY_API_KEY: "test" }, { fetcher });
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

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

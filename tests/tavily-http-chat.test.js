import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function setup(enabled = "true", quota = 3) {
  const used = new Map(), calls = [], prompts = [];
  const env = {
    URL_READER_ENABLED: enabled, URL_READER_PROVIDER: "tavily",
    TAVILY_API_KEY: "mock-key", TAVILY_EXTRACT_DAILY_URL_LIMIT: quota,
    DB: { prepare() { return { bind(day, subject, units, _time, limit) { return {
      async first() {
        const k = day + subject, n = (used.get(k) || 0) + units;
        if (n > limit) return null;
        used.set(k, n); return { units: n };
      }
    }; } }; } },
    AI: { async run(_model, options) {
      prompts.push(JSON.stringify(options));
      return { response: "Ringkasan informasi halaman publik yang tersedia." };
    } },
    TAVILY_EXTRACT_FETCHER: async (_url, options) => {
      const urls = JSON.parse(options.body).urls;
      calls.push(urls);
      return new Response(JSON.stringify({ results: urls.map(url => ({
        url, raw_content: "This is public page content sufficiently long to summarize and cite."
      })) }));
    }
  };
  return { env, calls, prompts };
}
async function chat(env, message) {
  const response = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, agent: "coordinator" })
  }), env);
  return { status: response.status, body: await response.json() };
}

test("HTTP chat reads public URL through mocked Tavily and passes untrusted page context", async () => {
  const { env, calls, prompts } = setup();
  const result = await chat(env, "Ringkas https://example.com/guide");
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [["https://example.com/guide"]]);
  assert.ok(prompts.some(x => x.includes("This is public page content")));
  assert.ok(prompts.some(x => x.includes("untrusted data copied from the internet")));
});
test("HTTP chat with URL Reader OFF never calls Tavily", async () => {
  const { env, calls } = setup("false");
  assert.equal((await chat(env, "Ringkas https://example.com/guide")).status, 200);
  assert.equal(calls.length, 0);
});
test("HTTP chat blocks URL query string before sending to Tavily", async () => {
  const { env, calls } = setup();
  assert.equal((await chat(env, "Ringkas https://example.com/guide?data=secret")).status, 200);
  assert.equal(calls.length, 0);
});
test("HTTP chat quota exhaustion blocks further Tavily requests", async () => {
  const { env, calls } = setup("true", 1);
  assert.equal((await chat(env, "Ringkas https://example.com/one")).status, 200);
  assert.equal((await chat(env, "Ringkas https://example.com/two")).status, 200);
  assert.deepEqual(calls, [["https://example.com/one"]]);
});

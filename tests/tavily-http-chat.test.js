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
  const result = await chat(env, "Ringkas https://example.com/guide?data=secret");
  // The model may fail its quality gate (502) when a requested URL cannot be read;
  // the security invariant is that the private query is never sent to Tavily.
  assert.ok([200, 502].includes(result.status));
  assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(result.body), /mock-key/);
});
test("HTTP chat quota exhaustion blocks further Tavily requests", async () => {
  const { env, calls } = setup("true", 1);
  assert.equal((await chat(env, "Ringkas https://example.com/one")).status, 200);
  assert.equal((await chat(env, "Ringkas https://example.com/two")).status, 200);
  assert.deepEqual(calls, [["https://example.com/one"]]);
});

test("HTTP chat does not leak Tavily provider errors or credentials", async () => {
  const { env } = setup();
  env.TAVILY_EXTRACT_FETCHER = async () => {
    throw new Error("upstream private-key mock-key internal-provider-failure");
  };
  const result = await chat(env, "Ringkas https://example.com/unavailable");
  assert.ok([200, 502].includes(result.status));
  assert.doesNotMatch(JSON.stringify(result.body), /private-key|mock-key|internal-provider-failure/);
});

test("HTTP chat does not treat malformed Tavily response as successful page extraction", async () => {
  const { env, prompts } = setup();
  env.TAVILY_EXTRACT_FETCHER = async () => new Response("{not-json", {
    headers: { "Content-Type": "application/json" }
  });
  const result = await chat(env, "Ringkas https://example.com/malformed");
  assert.ok([200, 502].includes(result.status));
  assert.ok(prompts.every(prompt => !prompt.includes("This is public page content")));
  assert.doesNotMatch(JSON.stringify(result.body), /mock-key/);
});

test("HTTP chat refuses Tavily extraction when the explicit budget is absent", async () => {
  const { env, calls } = setup();
  delete env.TAVILY_EXTRACT_DAILY_URL_LIMIT;
  const result = await chat(env, "Ringkas https://example.com/budget");
  assert.ok([200, 502].includes(result.status));
  assert.equal(calls.length, 0);
});


test("HTTP chat reads BOR AI public assets with Tavily disabled, without any provider call", async () => {
  const { env, calls, prompts } = setup("false");
  const paths = [];
  env.ASSETS = { async fetch(req) {
    paths.push(new URL(req.url).pathname);
    assert.equal(req.headers.get("cookie"), null);
    assert.equal(req.headers.get("authorization"), null);
    return new Response("<title>BOR AI</title><p>BOR AI offers a helpful public assistant and a clear view of available features.</p>", { headers: { "Content-Type": "text/html" } });
  } };
  const result = await chat(env, "Ringkas https://example.test/ dan https://example.test/paket.html");
  assert.equal(result.status, 200);
  assert.deepEqual(paths, ["/", "/paket"]);
  assert.deepEqual(calls, []);
  assert.deepEqual(result.body.links.map(x => x.ok), [true, true]);
  assert.ok(prompts.some(p => p.includes("helpful public assistant")));
});

test("HTTP chat blocks account pages and query URLs even when external reading is enabled", async () => {
  const { env, calls } = setup("true");
  let assetCalls = 0;
  env.ASSETS = { async fetch() { assetCalls++; throw Error("private route should not be fetched"); } };
  const result = await chat(env, "Baca https://example.test/api/auth/me dan https://example.test/paket?token=secret");
  assert.equal(assetCalls, 0);
  assert.deepEqual(calls, []);
  assert.ok([200, 502].includes(result.status));
  if (result.body.links) assert.ok(result.body.links.every(link => !link.ok));
});

test("HTTP chat preserves citation order for local public and unavailable external pages", async () => {
  const { env, calls } = setup("false");
  env.ASSETS = { async fetch() {
    return new Response("<title>BOR AI</title><p>Public BOR AI homepage explains useful AI features and general information.</p>", { headers: { "Content-Type": "text/html" } });
  } };
  const result = await chat(env, "Ringkas https://example.test/ dan https://other.example/article");
  assert.equal(result.status, 200);
  assert.deepEqual(calls, []);
  assert.deepEqual(result.body.links.map(link => [link.host, link.ok]), [
    ["example.test", true], ["other.example", false]
  ]);
});

test("HTTP chat sends only external URLs to Tavily when explicitly enabled", async () => {
  const { env, calls } = setup("true");
  env.ASSETS = { async fetch() {
    return new Response("<title>BOR AI</title><p>This is the public homepage for the BOR AI assistant and its features.</p>", { headers: { "Content-Type": "text/html" } });
  } };
  const result = await chat(env, "Ringkas https://example.test/ dan https://example.com/guide");
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [["https://example.com/guide"]]);
  assert.deepEqual(result.body.links.map(link => link.ok), [true, true]);
});

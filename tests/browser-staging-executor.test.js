import test from "node:test";
import assert from "node:assert/strict";
import { executeStagingBrowserRead } from "../src/browser-staging-executor.js";

function fakeRunner({ finalUrl = "https://example.com/article", status = 200, pageText = "This is a public page with enough readable text to summarize.", failAt = null } = {}) {
  const spy = { launches: [], routes: [], closed: 0, contextClosed: 0, navigation: [] };
  const page = {
    async goto(url, settings) {
      spy.navigation.push({ url, settings });
      if (failAt === "goto") throw Error("simulated transport failure with secret content");
      return { status: () => status };
    },
    url: () => finalUrl,
    async title() { return "Public article"; },
    async evaluate(callback) {
      if (failAt === "evaluate") throw Error("simulated extraction failure");
      if (String(callback).includes("querySelectorAll")) return [
        { url: "https://example.com/also-public", label: "Read more" },
        { url: "https://example.com/private?token=something", label: "Should be removed" },
        { url: "https://other.example.com/resource", label: "Cross host" }
      ];
      return pageText;
    }
  };
  const context = {
    async route(pattern, callback) { spy.routes.push({ pattern, callback }); },
    async newPage() { return page; },
    async close() { spy.contextClosed++; }
  };
  const browser = {
    async newContext(config) { spy.context = config; return context; },
    async close() { spy.closed++; }
  };
  const launch = async (binding, options) => {
    spy.launches.push({ binding, options });
    return browser;
  };
  return { spy, launch };
}
const ENV = {
  STAGING_BROWSER_ENABLED: "true",
  STAGING_BROWSER_PILOT_HOST: "example.com",
  BOR_BROWSER: { fake: true }
};

test("stage-only browser opens exactly one guarded host, reads real DOM mock and closes session", async () => {
  const fake = fakeRunner();
  const result = await executeStagingBrowserRead("https://example.com/article", ENV, { launch: fake.launch });
  assert.equal(result.ok, true);
  assert.equal(result.status, "page_read");
  assert.equal(result.renderedInBrowserSession, true);
  assert.equal(result.sourceType, "browser_read");
  assert.equal(result.title, "Public article");
  assert.equal(result.links.length, 1);
  assert.deepEqual(fake.spy.launches[0].options.guardrails, { allowedDomains: ["example.com"] });
  assert.equal(fake.spy.launches[0].binding, ENV.BOR_BROWSER);
  assert.equal(fake.spy.context.serviceWorkers, "block");
  assert.equal(fake.spy.context.acceptDownloads, false);
  assert.equal(fake.spy.navigation.length, 1);
  assert.equal(fake.spy.navigation[0].settings.waitUntil, "domcontentloaded");
  assert.equal(fake.spy.closed, 1);
  assert.equal(fake.spy.contextClosed, 1);
});

test("additional route gate rejects third-party hosts, URL secrets and browser POST side effects", async () => {
  const fake = fakeRunner();
  assert.equal((await executeStagingBrowserRead("https://example.com/article", ENV, { launch: fake.launch })).ok, true);
  const callback = fake.spy.routes[0].callback;
  let allowed = 0, blocked = 0;
  for (const [url, method, yes] of [
    ["https://example.com/script.js", "GET", true],
    ["https://example.com/submit", "POST", false],
    ["https://example.com/asset?api_key=123", "GET", false],
    ["https://not-example.com/path", "GET", false],
    ["https://127.0.0.1/admin", "GET", false],
    ["http://example.com/redirect", "GET", false]
  ]) {
    let observed = null;
    await callback({
      request() { return { url: () => url, method: () => method }; },
      continue() { observed = "continue"; allowed++; },
      abort() { observed = "abort"; blocked++; }
    });
    assert.equal(observed, yes ? "continue" : "abort", url);
  }
  assert.equal(allowed, 1);
  assert.equal(blocked, 5);
});

test("does not launch for disabled flag, unconfigured binding or arbitrary non-pilot domain", async () => {
  const fake = fakeRunner();
  assert.equal((await executeStagingBrowserRead("https://example.com/article", { ...ENV, STAGING_BROWSER_ENABLED: "false" }, { launch: fake.launch })).code, "browser_disabled");
  assert.equal((await executeStagingBrowserRead("https://unapproved.example.org/news", ENV, { launch: fake.launch })).code, "outside_pilot_hostname");
  assert.equal((await executeStagingBrowserRead("https://example.com/article", { ...ENV, BOR_BROWSER: null }, { launch: fake.launch })).code, "browser_not_connected");
  assert.equal(fake.spy.launches.length, 0);
});

test("redirect outside exact pilot host fails closed and closes the browser", async () => {
  const fake = fakeRunner({ finalUrl: "https://elsewhere.com/data" });
  const result = await executeStagingBrowserRead("https://example.com/article", ENV, { launch: fake.launch });
  assert.equal(result.code, "navigation_not_permitted");
  assert.equal(fake.spy.closed, 1);
  assert.equal(fake.spy.contextClosed, 1);
});

test("HTTP errors and empty or malicious page result do not count as readable source", async () => {
  const blocked = fakeRunner({ status: 403 });
  assert.equal((await executeStagingBrowserRead("https://example.com/article", ENV, { launch: blocked.launch })).code, "page_unavailable");
  const empty = fakeRunner({ pageText: "  " });
  assert.equal((await executeStagingBrowserRead("https://example.com/article", ENV, { launch: empty.launch })).code, "page_text_empty");
  const failed = fakeRunner({ failAt: "evaluate" });
  assert.equal((await executeStagingBrowserRead("https://example.com/article", ENV, { launch: failed.launch })).code, "browser_read_failed");
  assert.equal(failed.spy.closed, 1);
});

test("long HTML result is truncated instead of leaking an unbounded DOM into AI context", async () => {
  const fake = fakeRunner({ pageText: "B".repeat(20_000) });
  const result = await executeStagingBrowserRead("https://example.com/article", ENV, { launch: fake.launch });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, 12_000);
});

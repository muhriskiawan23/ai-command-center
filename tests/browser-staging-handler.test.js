import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserStagingHandler } from "../src/browser-staging-handler.js";

const SECRET = "stage-operator-token-" + "z".repeat(40);
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const URL = "https://staging.example.test/api/browser/read";

function makeDb() {
  let used = 0, lease = null;
  return {
    get used() { return used; },
    get lease() { return lease; },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("INSERT INTO browser_staging_lease")) {
                if (lease && lease.expires > args[2]) return null;
                lease = { token: args[0], expires: args[1] };
                return { slot: 1 };
              }
              if (sql.includes("INSERT INTO browser_staging_usage")) {
                if (used + args[1] > args[3]) return null;
                used += args[1];
                return { reserved_seconds: used };
              }
              throw Error("Unexpected SQL");
            },
            async run() {
              if (sql.includes("DELETE FROM browser_staging_lease") && lease?.token === args[0]) lease = null;
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}
function makeEnv() {
  return {
    STAGING_BROWSER_ENABLED: "true",
    STAGING_BROWSER_OPERATOR_TOKEN: SECRET,
    STAGING_BROWSER_PILOT_HOST: "example.com",
    STAGING_BROWSER_DAILY_SECONDS_LIMIT: "30",
    STAGING_BROWSER_RESERVATION_SECONDS: "30",
    BOR_BROWSER: { demo: true },
    BROWSER_DB: makeDb()
  };
}
function req(payload, { secret = SECRET, method = "POST", contentType = "application/json" } = {}) {
  return new Request(URL, {
    method,
    headers: { authorization: "Bearer " + secret, "content-type": contentType },
    body: method === "POST" ? JSON.stringify(payload) : undefined
  });
}
const NOW = Date.parse("2026-11-21T04:00:00Z");

function launcher(spy = { calls: 0, closes: 0 }) {
  return async (_, opts) => {
    spy.calls++; spy.options = opts;
    return {
      newContext: async () => ({
        route: async () => {},
        newPage: async () => ({
          goto: async () => ({ status: () => 200 }),
          url: () => "https://example.com/article",
          title: async () => "Verified pilot article",
          evaluate: async fn => String(fn).includes("querySelectorAll") ? [] : "Actual test article text from a mocked rendered page."
        }),
        close: async () => {}
      }),
      close: async () => { spy.closes++; }
    };
  };
}

test("disabled staging returns fail closed before auth, D1 and browser launch", async () => {
  const spy = { calls: 0, closes: 0 };
  const handle = createBrowserStagingHandler({ launch: launcher(spy) });
  const result = await handle(req({ url: "https://example.com/article" }), { ...makeEnv(), STAGING_BROWSER_ENABLED: "false" });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "staging_disabled");
  assert.equal(spy.calls, 0);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("health is not a shortcut to trigger browser activity", async () => {
  const handle = createBrowserStagingHandler({ launch: launcher() });
  const response = await handle(new Request("https://staging.example.test/health"), makeEnv());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).browserAttempted, false);
});

test("staging endpoint rejects missing/wrong authorization without browser or quota changes", async () => {
  const env = makeEnv(), spy = { calls: 0 };
  const handle = createBrowserStagingHandler({ launch: launcher(spy) });
  const response = await handle(req({ url: "https://example.com/article" }, { secret: "wrong" }), env);
  assert.equal(response.status, 401);
  assert.equal(env.BROWSER_DB.used, 0);
  assert.equal(spy.calls, 0);
  assert.doesNotMatch(await response.text(), /stage-operator-token/);
});

test("staging reads only the configured host after quota reservation and closes browser", async () => {
  const env = makeEnv(), spy = { calls: 0, closes: 0 };
  const handle = createBrowserStagingHandler({ launch: launcher(spy), makeToken: () => UUID, clock: () => NOW });
  const response = await handle(req({ url: "https://example.com/article" }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.stagingOnly, true);
  assert.equal(result.remainingReservedBudgetSeconds, 0);
  assert.equal(result.status, "page_read");
  assert.match(result.text, /Actual test article text/);
  assert.equal(spy.calls, 1);
  assert.equal(spy.closes, 1);
  assert.deepEqual(spy.options.guardrails, { allowedDomains: ["example.com"] });
  assert.equal(env.BROWSER_DB.lease, null);
  const second = await handle(req({ url: "https://example.com/article" }), env);
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error, "browser_daily_quota_exhausted");
  assert.equal(spy.calls, 1);
});

test("target outside pilot and URL token leaks rejected before any D1 reservation", async () => {
  const env = makeEnv(), spy = { calls: 0 };
  const handle = createBrowserStagingHandler({ launch: launcher(spy) });
  assert.equal((await handle(req({ url: "https://other.example.com/article" }), env)).status, 403);
  assert.equal((await handle(req({ url: "https://example.com/article?token=secret" }), env)).status, 400);
  assert.equal(env.BROWSER_DB.used, 0);
  assert.equal(spy.calls, 0);
});

test("read endpoint rejects non-JSON, extra input fields, unsupported methods and oversized bodies", async () => {
  const env = makeEnv(), handle = createBrowserStagingHandler({ launch: launcher() });
  assert.equal((await handle(req({ url: "https://example.com/article" }, { contentType: "text/plain" }), env)).status, 415);
  assert.equal((await handle(req({ url: "https://example.com/article", cookies: "unsafe" }), env)).status, 400);
  assert.equal((await handle(req({ url: "https://example.com/article", padding: "X".repeat(2000) }), env)).status, 400);
  assert.equal((await handle(req({}, { method: "GET" }), env)).status, 405);
  assert.equal(env.BROWSER_DB.used, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { handleGitHubOAuthRoute } from "../src/github-oauth.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function makeDb(userId = "google-user-1") {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = { sql, values: [], bind(...values) { this.values = values; return this; },
        async first() {
          calls.push({ type: "first", sql, values: this.values });
          if (sql.includes("SELECT user_id, github_user_id")) return null;
          if (sql.includes("SELECT user_id FROM github_oauth_states")) return { user_id: userId };
          return null;
        },
        async run() { calls.push({ type: "run", sql, values: this.values }); return { success: true }; }
      };
      return statement;
    }
  };
}
const deps = {
  getSession: async () => ({ id: "google-user-1" }),
  sameOrigin: () => true,
  randomToken: () => "random-state-token",
  sha256Hex: async (value) => "hash:" + value,
  json
};
const env = () => ({
  DB: makeDb(),
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_REDIRECT_URI: "https://example.test/api/github/callback",
  GITHUB_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
});

test("GitHub OAuth endpoints require a signed-in BOR AI user", async () => {
  const response = await handleGitHubOAuthRoute(new Request("https://example.test/api/github/connect"), env(), new URL("https://example.test/api/github/connect"), { ...deps, getSession: async () => null });
  assert.equal(response.status, 401);
});

test("GitHub OAuth reports missing app configuration without exposing secrets", async () => {
  const response = await handleGitHubOAuthRoute(new Request("https://example.test/api/github/connect"), { DB: makeDb() }, new URL("https://example.test/api/github/connect"), deps);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /client-secret|AAAAAAAA/);
});

test("connect creates a one-time user-bound state and redirects to GitHub", async () => {
  const bindings = env();
  const response = await handleGitHubOAuthRoute(new Request("https://example.test/api/github/connect"), bindings, new URL("https://example.test/api/github/connect"), deps);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
  assert.ok(bindings.DB.calls.some((call) => call.sql?.includes("INSERT INTO github_oauth_states")));
});

test("callback rejects a mismatched state before exchanging a code", async () => {
  const request = new Request("https://example.test/api/github/callback?code=code&state=attacker", { headers: { Cookie: "__Host-borai_github_oauth_state=valid" } });
  const response = await handleGitHubOAuthRoute(request, env(), new URL(request.url), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/?github=error&reason=state_cookie");
});

test("callback handles GitHub authorization denial before requiring an authorization code", async () => {
  const request = new Request("https://example.test/api/github/callback?error=access_denied&state=random-state-token", {
    headers: { Cookie: "__Host-borai_github_oauth_state=random-state-token" }
  });
  const response = await handleGitHubOAuthRoute(request, env(), new URL(request.url), deps);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/?github=cancelled");
});


test("callback reports GitHub profile API authorization failures precisely", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/login/oauth/access_token")) return json({ access_token: "user-token" });
    if (String(url).endsWith("/user")) return json({ message: "Bad credentials" }, 401);
    throw new Error("Unexpected fetch URL");
  };
  try {
    const request = new Request("https://example.test/api/github/callback?code=valid-code&state=random-state-token", {
      headers: { Cookie: "__Host-borai_github_oauth_state=random-state-token" }
    });
    const response = await handleGitHubOAuthRoute(request, env(), new URL(request.url), deps);
    assert.equal(response.status, 302);
    assert.match(response.headers.get("Location"), /^\/\?github=error&reason=profile_http_401&github_message=Bad\+credentials$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callback distinguishes an invalid GitHub profile payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/login/oauth/access_token")) return json({ access_token: "user-token" });
    if (String(url).endsWith("/user")) return json({ id: "not-a-number", login: null });
    throw new Error("Unexpected fetch URL");
  };
  try {
    const request = new Request("https://example.test/api/github/callback?code=valid-code&state=random-state-token", {
      headers: { Cookie: "__Host-borai_github_oauth_state=random-state-token" }
    });
    const response = await handleGitHubOAuthRoute(request, env(), new URL(request.url), deps);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "/?github=error&reason=profile_invalid");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callback preserves GitHub 403 and logs safe diagnostic metadata only", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  globalThis.fetch = async (url) => {
    if (String(url).includes("/login/oauth/access_token")) return json({ access_token: "ghu_sensitive-user-token" });
    if (String(url).endsWith("/user")) return json(
      { message: "Resource not accessible by integration" },
      403,
      {
        "x-github-request-id": "REQ-123",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1900000000",
        "retry-after": "60",
        "x-accepted-github-permissions": "profile=read"
      }
    );
    throw new Error("Unexpected fetch URL");
  };
  try {
    const request = new Request("https://example.test/api/github/callback?code=valid-code&state=random-state-token", {
      headers: { Cookie: "__Host-borai_github_oauth_state=random-state-token" }
    });
    const response = await handleGitHubOAuthRoute(request, env(), new URL(request.url), deps);
    assert.match(response.headers.get("Location"), /^\/\?github=error&reason=profile_http_403&github_message=Resource\+not\+accessible\+by\+integration&github_request=REQ-123&github_rate_remaining=0$/);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "GitHub API request failed");
    const diagnostic = warnings[0][1];
    assert.equal(diagnostic.status, 403);
    assert.equal(diagnostic.requestId, "REQ-123");
    assert.equal(diagnostic.rateLimitRemaining, "0");
    assert.equal(diagnostic.retryAfter, "60");
    assert.equal(diagnostic.acceptedPermissions, "profile=read");
    assert.doesNotMatch(JSON.stringify(warnings), /ghu_sensitive-user-token|valid-code|client-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

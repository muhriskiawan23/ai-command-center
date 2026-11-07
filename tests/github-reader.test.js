import test from "node:test";
import assert from "node:assert/strict";
import { handleGitHubReadRoute } from "../src/github-reader.js";

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}
function request(path, method = "GET") {
  return new Request("https://example.test" + path, { method });
}
function fetcherFor(data, status = 200, headers = {}) {
  return async (url, init) => {
    assert.equal(new URL(url).hostname, "api.github.com");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Accept, "application/vnd.github+json");
    return Response.json(data, { status, headers });
  };
}

test("repository endpoint returns a compact public repository profile", async () => {
  const res = await handleGitHubReadRoute(request("/api/github/repository?owner=octocat&repo=Hello-World"), {}, new URL("https://example.test/api/github/repository?owner=octocat&repo=Hello-World"), {
    fetcher: fetcherFor({ id: 1, name: "Hello-World", full_name: "octocat/Hello-World", private: false, default_branch: "main", stargazers_count: 4 }),
    json
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.repository, "octocat/Hello-World");
  assert.equal(body.data.defaultBranch, "main");
  assert.equal(body.data.private, false);
});

test("file endpoint decodes UTF-8 base64 contents", async () => {
  const content = btoa("console.log('halo');");
  const res = await handleGitHubReadRoute(request("/api/github/file?owner=octocat&repo=Hello-World&path=src%2Findex.js"), {}, new URL("https://example.test/api/github/file?owner=octocat&repo=Hello-World&path=src%2Findex.js"), {
    fetcher: fetcherFor({ type: "file", name: "index.js", path: "src/index.js", sha: "abc", encoding: "base64", content }),
    json
  });
  const body = await res.json();
  assert.equal(body.data.content, "console.log('halo');");
});

test("tree endpoint encodes each path segment and returns directory entries", async () => {
  let requested;
  const fetcher = async (url) => { requested = url; return Response.json([{ name: "a.js", path: "src/a.js", type: "file", sha: "x" }]); };
  const res = await handleGitHubReadRoute(request("/api/github/tree?owner=octocat&repo=Hello-World&path=src%2Fa.js"), {}, new URL("https://example.test/api/github/tree?owner=octocat&repo=Hello-World&path=src%2Fa.js"), { fetcher, json });
  assert.equal(res.status, 200);
  assert.match(requested, /contents\/src\/a\.js$/);
  assert.equal((await res.json()).data[0].name, "a.js");
});

test("invalid owner, repo and traversal paths are rejected before fetch", async () => {
  for (const path of [
    "/api/github/repository?owner=..&repo=repo",
    "/api/github/repository?owner=octocat&repo=bad%2Frepo",
    "/api/github/tree?owner=octocat&repo=repo&path=..%2Fsecret"
  ]) {
    let called = false;
    const res = await handleGitHubReadRoute(request(path), {}, new URL("https://example.test" + path), { fetcher: async () => { called = true; }, json });
    assert.equal(res.status, 400);
    assert.equal(called, false);
  }
});

test("write methods are rejected", async () => {
  const res = await handleGitHubReadRoute(request("/api/github/repository?owner=octocat&repo=repo", "POST"), {}, new URL("https://example.test/api/github/repository?owner=octocat&repo=repo"), { fetcher: async () => { throw new Error("must not fetch"); }, json });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "GET");
});

test("GitHub not-found responses explain that only public repositories are supported", async () => {
  const res = await handleGitHubReadRoute(request("/api/github/repository?owner=octocat&repo=private"), {}, new URL("https://example.test/api/github/repository?owner=octocat&repo=private"), { fetcher: fetcherFor({ message: "Not Found" }, 404), json });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /repository publik/i);
});

test("GitHub API rate limits are mapped to 429", async () => {
  const res = await handleGitHubReadRoute(request("/api/github/repository?owner=octocat&repo=repo"), {}, new URL("https://example.test/api/github/repository?owner=octocat&repo=repo"), { fetcher: fetcherFor({ message: "rate limit" }, 403, { "X-RateLimit-Remaining": "0" }), json });
  assert.equal(res.status, 429);
});

test("pull request state is validated", async () => {
  let called = false;
  const path = "/api/github/pulls?owner=octocat&repo=repo&state=merged";
  const res = await handleGitHubReadRoute(request(path), {}, new URL("https://example.test" + path), { fetcher: async () => { called = true; }, json });
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("public repository reads use a namespaced rate-limit key", async () => {
  let key;
  const path = "/api/github/repository?owner=octocat&repo=repo";
  const res = await handleGitHubReadRoute(request(path), {
    CHAT_LIMITER: { async limit(input) { key = input.key; return { success: false }; } }
  }, new URL("https://example.test" + path), { fetcher: async () => { throw new Error("must not fetch"); }, json });
  assert.equal(res.status, 429);
  assert.match(key, /^github:/);
});

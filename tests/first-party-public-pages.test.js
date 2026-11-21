import test from "node:test";
import assert from "node:assert/strict";
import { isFirstPartyHost, readFirstPartyPublicLink } from "../src/first-party-public-pages.js";

const ownHost = "example.test";
const html = "<html><head><title>BOR AI</title></head><body><h1>Explore BOR AI</h1><p>This public page explains the application features and its general pricing.</p></body></html>";

test("first-party host matching requires the exact hostname, not a suffix", () => {
  assert.equal(isFirstPartyHost("https://example.test/", ownHost), true);
  assert.equal(isFirstPartyHost("https://EXAMPLE.TEST./", ownHost), true);
  assert.equal(isFirstPartyHost("https://example.test.evil.example/", ownHost), false);
  assert.equal(isFirstPartyHost("https://another.test/", ownHost), false);
});

test("public BOR AI pages are read through fixed static assets without cookies or tokens", async () => {
  const seen = [];
  const assets = { async fetch(request) {
    seen.push(request);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } };
  const home = await readFirstPartyPublicLink("https://example.test/index.html#intro", ownHost, assets);
  const pricing = await readFirstPartyPublicLink("https://example.test/paket.html", ownHost, assets);
  assert.equal(home.ok, true);
  assert.equal(pricing.ok, true);
  assert.deepEqual(seen.map(req => new URL(req.url).pathname), ["/index.html", "/paket.html"]);
  assert.ok(seen.every(req => req.method === "GET"));
  assert.ok(seen.every(req => req.headers.get("cookie") === null && req.headers.get("authorization") === null));
  assert.ok(seen.every(req => req.redirect === "manual"));
  assert.equal(home.url, "https://example.test/index.html");
  assert.match(home.text, /application features/);
});

test("private and query-bearing same-host URLs never reach the asset binding", async () => {
  let called = 0;
  const assets = { async fetch() { called++; return new Response(html); } };
  for (const url of [
    "https://example.test/api/auth/me",
    "https://example.test/account",
    "https://example.test/paket?token=abc",
    "https://example.test/paket?utm_campaign=secret",
    "https://user:secret@example.test/",
    "http://example.test/",
    "https://example.test:8443/",
    "https://example.test/privileged"
  ]) {
    const result = await readFirstPartyPublicLink(url, ownHost, assets);
    assert.equal(result.ok, false, url);
  }
  assert.equal(called, 0);
});

test("static-asset redirects fail closed without following any target", async () => {
  const assets = { async fetch() {
    return Response.redirect("https://example.test/api/auth/me", 302);
  } };
  const result = await readFirstPartyPublicLink("https://example.test/", ownHost, assets);
  assert.equal(result.ok, false);
});

test("external and lookalike hosts are not classified as first-party", async () => {
  let calls = 0;
  const assets = { async fetch() { calls++; return new Response(html); } };
  assert.equal(await readFirstPartyPublicLink("https://example.test.evil.example/", ownHost, assets), null);
  assert.equal(await readFirstPartyPublicLink("https://unrelated.example/", ownHost, assets), null);
  assert.equal(calls, 0);
});

test("unavailable ASSETS binding fails closed", async () => {
  const result = await readFirstPartyPublicLink("https://example.test/", ownHost, null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /belum tersedia/);
});


test("first-party reader opens the repository's actual public HTML assets, not a nonexistent clean URL", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const observed = [];
  const assets = { async fetch(req) {
    const pathname = new URL(req.url).pathname;
    observed.push(pathname);
    const fileUrl = new URL("../public" + pathname, import.meta.url);
    assert.equal(existsSync(fileUrl), true, "static asset must exist: " + pathname);
    return new Response(readFileSync(fileUrl), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  } };
  const home = await readFirstPartyPublicLink("https://example.test/", ownHost, assets);
  const pricing = await readFirstPartyPublicLink("https://example.test/paket", ownHost, assets);
  assert.deepEqual(observed, ["/index.html", "/paket.html"]);
  assert.equal(home.ok, true, home.reason);
  assert.equal(pricing.ok, true, pricing.reason);
  assert.ok(home.chars > 40);
  assert.ok(pricing.chars > 40);
});

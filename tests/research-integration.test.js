import test from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./e2e/harness.js";

test("chat attaches curated knowledge and live news results with source IDs and citations metadata", async () => {
  const app = await startHarness({
    extraEnv: {
      BRAVE_SEARCH_API_KEY: "test-secret",
      SEARCH_FETCHER: async (url, init) => {
        assert.match(url, /\/news\/search/);
        assert.equal(init.headers["X-Subscription-Token"], "test-secret");
        return new Response(JSON.stringify({ results: [{
          title: "Berita BOR AI",
          url: "https://publisher.example/bor-ai",
          description: "Laporan tentang perkembangan AI.",
          page_age: new Date().toISOString()
        }] }), { headers: { "content-type": "application/json" } });
      }
    }
  });
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Cari berita terbaru tentang BOR AI privacy" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.links.some((source) => source.sourceType === "curated" && source.ok));
    assert.ok(body.links.some((source) => source.sourceType === "news" && source.ok));
    const userContent = app.aiCalls.at(-1).messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
    assert.match(userContent, /<curated_document/);
    assert.match(userContent, /<research_source/);
    assert.match(userContent, /Laporan tentang perkembangan AI/);
    assert.match(userContent, /Cite each externally supported claim/);
  } finally {
    await app.close();
  }
});

test("chat never claims live news was searched when provider secret is absent", async () => {
  let networkCalls = 0;
  const app = await startHarness({ extraEnv: { SEARCH_FETCHER: async () => { networkCalls++; throw new Error("must not call"); } } });
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Cari berita terbaru tentang kebijakan AI" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(networkCalls, 0);
    assert.ok(body.links.some((source) => source.ok === false && /belum aktif/.test(source.reason)));
    const userContent = app.aiCalls.at(-1).messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
    assert.match(userContent, /No live external search was performed/);
  } finally {
    await app.close();
  }
});

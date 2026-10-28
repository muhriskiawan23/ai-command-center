import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  AI: {
    calls: 0,
    async run(model, options) {
      this.calls += 1;
      return { response: "Tokyo adalah ibu kota Jepang. Kota ini menjadi pusat pemerintahan nasional dan salah satu pusat ekonomi utama negara tersebut. Jawaban ini menjawab pertanyaan secara langsung." };
    }
  },
  ASSETS: { async fetch() { return new Response("asset"); } }
};

test("health endpoint returns a no-store success response", async () => {
  const res = await worker.fetch(new Request("https://example.test/api/health"), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("agents endpoint lists configured agents", async () => {
  const res = await worker.fetch(new Request("https://example.test/api/agents"), env);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.agents.some((agent) => agent.id === "coordinator"));
  assert.ok(data.agents.some((agent) => agent.id === "fact_checker"));
});

test("invalid JSON is rejected", async () => {
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid"
  }), env);
  assert.equal(res.status, 400);
});

test("empty messages are rejected", async () => {
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " })
  }), env);
  assert.equal(res.status, 400);
});

test("oversized messages are rejected", async () => {
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(12001) })
  }), env);
  assert.equal(res.status, 400);
});

test("simple coordinator request uses one model call", async () => {
  env.AI.calls = 0;
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Apa ibu kota Jepang?", agent: "coordinator" })
  }), env);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.workflow, "single-agent");
  assert.equal(data.response.includes("Tokyo"), true);
  assert.equal(env.AI.calls, 1);
});

test("model errors return a generic public message without internal details", async () => {
  const brokenEnv = { AI: { async run() { throw new Error("internal-secret-detail"); } } };
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Apa ibu kota Jepang?" })
  }), brokenEnv);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal("detail" in data, false);
  assert.equal(JSON.stringify(data).includes("internal-secret-detail"), false);
});

test("short coordinator answers are preserved instead of replaced by generic fallback", async () => {
  const shortEnv = {
    AI: { async run() { return { response: "Hai!" }; } },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Sapa saya dengan singkat." })
  }), shortEnv);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.response, "Hai!");
});

test("unusable specialist output fails honestly instead of returning a generic fallback as success", async () => {
  const weakEnv = {
    AI: { async run() { return { response: "OK" }; } },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Buat analisis", agent: "analyst" })
  }), weakEnv);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(data.error, "AI gagal memproses permintaan. Silakan coba lagi beberapa saat.");
  assert.equal(JSON.stringify(data).includes("Analisis: pilih langkah"), false);
});

test("empty coordinator output is retried and then rejected instead of returned as success", async () => {
  let calls = 0;
  const emptyEnv = {
    AI: {
      async run() {
        calls += 1;
        return { response: "   " };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Jelaskan secara singkat." })
  }), emptyEnv);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(calls, 2);
  assert.equal(data.error, "AI gagal memproses permintaan. Silakan coba lagi beberapa saat.");
  assert.equal("response" in data, false);
});

test("malformed model output is retried and returns a sanitized 502", async () => {
  let calls = 0;
  const malformedEnv = {
    AI: {
      async run() {
        calls += 1;
        return { unexpected: "provider response shape changed" };
      }
    },
    ASSETS: { async fetch() { return new Response("asset"); } }
  };
  const res = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Jelaskan secara singkat." })
  }), malformedEnv);
  const data = await res.json();
  assert.equal(res.status, 502);
  assert.equal(calls, 2);
  assert.equal(data.error, "AI gagal memproses permintaan. Silakan coba lagi beberapa saat.");
  assert.equal(JSON.stringify(data).includes("provider response shape changed"), false);
  assert.equal("response" in data, false);
});

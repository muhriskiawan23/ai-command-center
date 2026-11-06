import test from "node:test";
import assert from "node:assert/strict";
import { handleDeveloperKeysRoute, handlePublicChatRoute } from "../src/widget-api.js";

function makeDb({ key = null, quota = { daily_used: 1, daily_limit: 100 }, changes = 1 } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.push({ sql, args, method: "first" });
              if (sql.includes("SELECT id, allowed_origins")) return key;
              if (sql.includes("RETURNING daily_used")) return quota;
              return null;
            },
            async all() {
              calls.push({ sql, args, method: "all" });
              return { results: [] };
            },
            async run() {
              calls.push({ sql, args, method: "run" });
              return { meta: { changes } };
            }
          };
        }
      };
    }
  };
}

const secret = "borai_live_abcdefghijklmnopqrstuvwxyz123456789";
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const validKey = { id: "key-1", allowed_origins: JSON.stringify(["https://shop.example"]), daily_limit: 100 };

const deps = {
  AGENTS: { coordinator: { name: "Coordinator" }, writer: { name: "Writer" } },
  MODEL: "test-model",
  runAgent: async (_env, agent, message) => ({ response: "Jawaban BOR AI untuk: " + message }),
  withAiDeadline: env => env,
  json: (data, status = 200, headers = {}) => Response.json(data, { status, headers }),
  readJsonRequest: async request => ({ body: await request.json() })
};

test("public chat accepts a valid key and allow-listed origin, and returns quota metadata", async () => {
  const DB = makeDb({ key: validKey, quota: { daily_used: 1, daily_limit: 100 } });
  const request = new Request("https://api.example/api/public/chat", {
    method: "POST",
    headers: { Origin: "https://shop.example", Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Halo BOR AI" })
  });
  const response = await handlePublicChatRoute(request, { DB }, deps);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.response, "Jawaban BOR AI untuk: Halo BOR AI");
  assert.equal(data.usage.remaining, 99);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://shop.example");
  assert.ok(DB.calls.some(call => call.sql.includes("UPDATE public_api_keys")));
});

test("public chat rejects origins outside the key allow-list", async () => {
  const DB = makeDb({ key: validKey });
  const request = new Request("https://api.example/api/public/chat", {
    method: "POST",
    headers: { Origin: "https://attacker.example", Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Halo" })
  });
  const response = await handlePublicChatRoute(request, { DB }, deps);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Origin ini tidak diizinkan/);
  assert.equal(DB.calls.some(call => call.sql.includes("UPDATE public_api_keys")), false);
});

test("public chat rejects missing API keys before database access", async () => {
  const DB = makeDb({ key: validKey });
  const request = new Request("https://api.example/api/public/chat", {
    method: "POST",
    headers: { Origin: "https://shop.example", "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Halo" })
  });
  const response = await handlePublicChatRoute(request, { DB }, deps);
  assert.equal(response.status, 401);
  assert.equal(DB.calls.length, 0);
});

test("public chat rejects exhausted daily quotas without invoking the model", async () => {
  const DB = makeDb({ key: validKey, quota: null });
  let called = false;
  const request = new Request("https://api.example/api/public/chat", {
    method: "POST",
    headers: { Origin: "https://shop.example", Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Halo" })
  });
  const response = await handlePublicChatRoute(request, { DB }, { ...deps, runAgent: async () => { called = true; return { response: "x" }; } });
  assert.equal(response.status, 429);
  assert.equal(called, false);
});

test("public chat preflight advertises only the required headers and methods", async () => {
  const request = new Request("https://api.example/api/public/chat", {
    method: "OPTIONS", headers: { Origin: "https://shop.example" }
  });
  const response = await handlePublicChatRoute(request, {}, deps);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://shop.example");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});

test("developer key creation stores only the hash and returns the secret once", async () => {
  const DB = makeDb();
  const request = new Request("https://app.example/api/developer/keys", {
    method: "POST",
    headers: { Origin: "https://app.example", "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Website", origins: ["https://shop.example"], dailyLimit: 50 })
  });
  const response = await handleDeveloperKeysRoute(request, { DB }, new URL(request.url), {
    getSession: async () => ({ id: "user-1" }),
    sameOrigin: () => true,
    randomToken: () => "a".repeat(43),
    sha256Hex: async value => "hash:" + value,
    json: deps.json
  });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.match(data.key, /^borai_live_/);
  assert.equal(data.dailyLimit, 50);
  const insert = DB.calls.find(call => call.sql.includes("INSERT INTO public_api_keys"));
  assert.ok(insert);
  assert.equal(insert.args[2], "hash:" + data.key);
  assert.equal(insert.args.includes(data.key), false);
});

test("developer key listing works for authenticated GET without an Origin header", async () => {
  const DB = makeDb();
  const request = new Request("https://app.example/api/developer/keys");
  const response = await handleDeveloperKeysRoute(request, { DB }, new URL(request.url), {
    getSession: async () => ({ id: "user-1" }),
    sameOrigin: () => false,
    randomToken: () => "unused",
    sha256Hex: async value => value,
    json: deps.json
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).keys, []);
});

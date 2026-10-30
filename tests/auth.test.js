import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const SESSION_COOKIE = "__Host-borai_session=test-session-secret";

function request(path, init = {}) {
  return new Request("https://example.test" + path, init);
}

function jsonRequest(path, body, headers = {}) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function mockAI() {
  return {
    async run() {
      return { response: "Jawaban ini menjelaskan langkah utama secara ringkas dan memberikan konteks yang cukup." };
    }
  };
}

function mockDB({ user = { id: "google-sub-123", email: "owner@example.com", name: "Owner", picture: "" }, ownedConversation = null } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          calls.push({ type: "first", sql, values: this.values });
          if (sql.includes("FROM sessions JOIN users")) return user;
          if (sql.includes("FROM conversations WHERE id = ? AND user_id = ?")) return ownedConversation;
          return null;
        },
        async all() { calls.push({ type: "all", sql, values: this.values }); return { results: [] }; },
        async run() { calls.push({ type: "run", sql, values: this.values }); return { meta: { changes: 0 } }; }
      };
      calls.push({ type: "prepare", sql });
      return statement;
    },
    async batch(statements) {
      calls.push({ type: "batch", statements: statements.map((item) => ({ sql: item.sql, values: item.values })) });
      return statements.map(() => ({ success: true }));
    }
  };
}

test("public configuration does not claim Google sign-in is ready without bindings", async () => {
  const res = await worker.fetch(request("/api/config"), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { googleClientId: null, googleSignInEnabled: false });
});

test("guest chat remains temporary and does not touch D1", async () => {
  const db = mockDB();
  const res = await worker.fetch(jsonRequest("/api/chat", { message: "Jelaskan secara singkat.", agent: "coordinator" }), {
    AI: mockAI(),
    DB: db
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.saved, false);
  assert.equal("conversationId" in data, false);
  assert.equal(db.calls.length, 0);
});

test("guest users cannot read account conversation history", async () => {
  const res = await worker.fetch(request("/api/conversations"), { DB: mockDB() });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /masuk dengan akun Google/i);
});

test("a user cannot delete a conversation that is not owned by their account", async () => {
  const db = mockDB({ ownedConversation: null });
  const res = await worker.fetch(request("/api/conversations/someone-elses-chat", {
    method: "DELETE",
    headers: { Cookie: SESSION_COOKIE, Origin: "https://example.test" }
  }), { DB: db });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Chat tidak ditemukan.");
  assert.ok(db.calls.some((call) => call.sql?.startsWith("DELETE FROM conversations WHERE id = ? AND user_id = ?")));
});

test("a signed-in chat is stored as one user/assistant pair and returns its conversation ID", async () => {
  const db = mockDB();
  const res = await worker.fetch(jsonRequest("/api/chat", { message: "Buat ringkasan.", agent: "coordinator" }, { Cookie: SESSION_COOKIE, Origin: "https://example.test" }), {
    AI: mockAI(),
    DB: db
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.saved, true);
  assert.match(data.conversationId, /^[a-f0-9-]{36}$/i);
  const batch = db.calls.find((call) => call.type === "batch");
  assert.ok(batch);
  assert.equal(batch.statements.length, 3);
  assert.match(batch.statements[0].sql, /INSERT INTO conversations/);
  assert.match(batch.statements[1].sql, /'user'/);
  assert.match(batch.statements[2].sql, /'assistant'/);
});

test("Google sign-in rejects a missing double-submit nonce before token verification", async () => {
  const db = mockDB();
  const res = await worker.fetch(jsonRequest("/api/auth/google", {
    credential: "header.payload.signature",
    nonce: "client-nonce"
  }, { Origin: "https://example.test" }), {
    DB: db,
    GOOGLE_CLIENT_ID: "public-client-id"
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /kedaluwarsa/i);
  assert.equal(db.calls.length, 0);
});

test("Google sign-in rejects cross-origin token submission", async () => {
  const res = await worker.fetch(jsonRequest("/api/auth/google", {
    credential: "header.payload.signature",
    nonce: "nonce"
  }, { Origin: "https://attacker.example" }), {
    DB: mockDB(),
    GOOGLE_CLIENT_ID: "public-client-id"
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "Origin tidak valid.");
});

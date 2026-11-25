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

function mockDB({ user = { id: "google-sub-123", email: "owner@example.com", name: "Owner", picture: "" }, ownedConversation = null, legacySchema = false } = {}) {
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
          if (sql.includes("daily_usage")) return { units: 1 };
          if (sql.includes("SELECT id FROM messages WHERE conversation_id")) return { id: 999 };
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
      if (legacySchema && statements.some((statement) => statement.sql.startsWith("INSERT INTO messages") && statement.sql.includes("idempotency_key"))) {
        throw new Error("table messages has no column named idempotency_key");
      }
      return statements.map((statement, index) => ({
        success: true,
        meta: { last_row_id: statement.sql.startsWith("INSERT INTO messages") ? 121 + index : 0 }
      }));
    }
  };
}

test("public configuration does not claim Google sign-in is ready without bindings", async () => {
  const res = await worker.fetch(request("/api/config"), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { googleClientId: null, googleSignInEnabled: false });
});

test("guest chat remains temporary: only usage counters touch D1, never conversations or messages", async () => {
  const db = mockDB();
  const res = await worker.fetch(jsonRequest("/api/chat", { message: "Jelaskan secara singkat.", agent: "coordinator" }), {
    AI: mockAI(),
    DB: db
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.saved, false);
  assert.equal("conversationId" in data, false);
  const statements = db.calls.filter((call) => call.sql).map((call) => call.sql);
  assert.ok(statements.length > 0 && statements.every((sql) => sql.includes("daily_usage")), `statement tak terduga: ${statements.join(" | ")}`);
  assert.equal(db.calls.filter((call) => call.type === "batch").length, 0);
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
  assert.equal(data.responseId, 123);
  assert.match(data.conversationId, /^[a-f0-9-]{36}$/i);
  const batch = db.calls.find((call) => call.type === "batch");
  assert.ok(batch);
  assert.equal(batch.statements.length, 3);
  assert.match(batch.statements[0].sql, /INSERT INTO conversations/);
  assert.match(batch.statements[1].sql, /'user'/);
  assert.match(batch.statements[2].sql, /'assistant'/);
});

test("signed-in chat uses the successful batch receipt on a legacy schema", async () => {
  const db = mockDB({ legacySchema: true });
  const res = await worker.fetch(jsonRequest("/api/chat", {
    message: "Buat ringkasan.",
    agent: "coordinator",
    requestId: crypto.randomUUID()
  }, { Cookie: SESSION_COOKIE, Origin: "https://example.test" }), {
    AI: mockAI(),
    DB: db
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.saved, true);
  assert.equal(data.responseId, 123);
  const batches = db.calls.filter((call) => call.type === "batch");
  assert.equal(batches.length, 2);
  assert.match(batches[0].statements[1].sql, /idempotency_key/);
  assert.doesNotMatch(batches[1].statements[1].sql, /idempotency_key/);
});

test("Google sign-in rejects a missing double-submit nonce before token verification", async () => {
  const db = mockDB();
  const res = await worker.fetch(jsonRequest("/api/auth/google", {
    credential: "header.payload.signature",
    nonce: "client-nonce"
  }, { Origin: "https://example.test" }), {
    DB: db,
    GOOGLE_CLIENT_ID: "public-client-id",
    CHAT_LIMITER: { async limit() { return { success: true }; } }
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

 
test("Google nonce endpoint rate-limits by its own IP-scoped bucket", async () => {
  const keys = [];
  const res = await worker.fetch(request("/api/auth/nonce"), {
    DB: mockDB(),
    GOOGLE_CLIENT_ID: "public-client-id",
    CHAT_LIMITER: { async limit({ key }) { keys.push(key); return { success: false }; } }
  });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  assert.match((await res.json()).error, /percobaan login/i);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^auth:nonce:/);
});

test("Google credential endpoint rate-limits before parsing credentials or touching D1", async () => {
  const db = mockDB();
  const keys = [];
  const res = await worker.fetch(jsonRequest("/api/auth/google", {
    credential: "header.payload.signature",
    nonce: "client-nonce"
  }, { Origin: "https://example.test" }), {
    DB: db,
    GOOGLE_CLIENT_ID: "public-client-id",
    CHAT_LIMITER: { async limit({ key }) { keys.push(key); return { success: false }; } }
  });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  assert.match((await res.json()).error, /percobaan login/i);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^auth:google:/);
  assert.equal(db.calls.length, 0);
});

test("Google authentication fails closed when the rate limiter binding is missing", async () => {
  for (const [path, init] of [
    ["/api/auth/nonce", {}],
    ["/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.test" }, body: JSON.stringify({ credential: "x", nonce: "x" }) }]
  ]) {
    const res = await worker.fetch(request(path, init), { DB: mockDB(), GOOGLE_CLIENT_ID: "public-client-id" });
    assert.equal(res.status, 503);
  }
});

test("Google authentication fails closed when the rate limiter throws", async () => {
  const res = await worker.fetch(request("/api/auth/nonce"), {
    DB: mockDB(),
    GOOGLE_CLIENT_ID: "public-client-id",
    CHAT_LIMITER: { async limit() { throw new Error("limiter unavailable"); } }
  });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /pembatasan percobaan login/i);
});


test("logout cannot claim server-side revocation when session storage is absent or reports failure", async () => {
  for (const env of [{}, {DB:{prepare(){return {bind(){return this},async run(){return {success:false}}}}}}]) {
    const res=await worker.fetch(request("/api/auth/logout",{method:"POST",headers:{Cookie:SESSION_COOKIE,Origin:"https://example.test"}}),env);
    assert.equal(res.status,503);
    assert.equal(res.headers.get("Set-Cookie"),null);
  }
  const guest=await worker.fetch(request("/api/auth/logout",{method:"POST",headers:{Origin:"https://example.test"}}),{});
  assert.equal(guest.status,200);
});
test("logout revokes hashed token, not raw cookie, and clears secure cookie",async()=>{
  const db=mockDB();
  const res=await worker.fetch(request("/api/auth/logout",{method:"POST",headers:{Cookie:SESSION_COOKIE,Origin:"https://example.test"}}),{DB:db});
  assert.equal(res.status,200);
  const call=db.calls.find(x=>x.type==="run"&&x.sql.includes("DELETE FROM sessions WHERE token_hash"));
  assert.match(call.values[0],/^[a-f0-9]{64}$/);
  assert.notEqual(call.values[0],"test-session-secret");
  assert.match(res.headers.get("Set-Cookie"),/Max-Age=0; Secure; HttpOnly; SameSite=Lax/);
});

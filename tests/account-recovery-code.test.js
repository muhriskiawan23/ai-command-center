import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../src/index.js";
import { createD1, seedSession, seedConversation } from "./e2e/harness.js";

const origin = "https://example.test";
const cookieName = "__Host-borai_session";
const base = "/api/auth/recovery-code/";
const hash = value => createHash("sha256").update(value).digest("hex");

function fixture(t) {
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  const user = { id: "owner", email: "owner@example.test" };
  const session = seedSession(DB, user);
  const env = {
    DB,
    BOR_ACCOUNT_RECOVERY_ENABLED: "true",
    CHAT_LIMITER: { limit: async () => ({ success: true }) }
  };
  function post(action, { token, code, from = origin } = {}) {
    return worker.fetch(new Request(origin + base + action, {
      method: "POST",
      headers: {
        Origin: from,
        "Content-Type": "application/json",
        ...(token && { Cookie: cookieName + "=" + token })
      },
      body: JSON.stringify({ code })
    }), env);
  }
  return { DB, user, session, env, post };
}

test("one-time recovery signs in to the existing account and survives refresh", async t => {
  const { DB, user, session, env, post } = fixture(t);
  seedConversation(DB, { id: "saved-chat", userId: user.id, title: "Saved chat", updatedAt: 10 });
  const issue = await post("issue", { token: session });
  assert.equal(issue.status, 200);
  assert.equal(issue.headers.get("Cache-Control"), "no-store");
  const { code } = await issue.json();
  assert.match(code, /^BOR-[a-zA-Z0-9_-]{32}$/);
  assert.equal(DB.sqlite.prepare("SELECT code_hash FROM account_recovery_codes").get().code_hash, hash(code));

  const results = await Promise.all([post("redeem", { code }), post("redeem", { code })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  const recovered = results.find(result => result.ok);
  assert.equal((await recovered.json()).user.id, user.id);
  const cookie = recovered.headers.getSetCookie()[0];
  assert.match(cookie, /; Secure; HttpOnly; SameSite=Lax$/);
  const headers = { Cookie: cookie.split(";")[0] };
  const me = await worker.fetch(new Request(origin + "/api/auth/me", { headers }), env);
  assert.equal((await me.json()).user.id, user.id);
  const conversations = await worker.fetch(new Request(origin + "/api/conversations", { headers }), env);
  assert.match(await conversations.text(), /saved-chat/);
  const logout = await worker.fetch(new Request(origin + "/api/auth/logout", {
    method: "POST", headers: { ...headers, Origin: origin }
  }), env);
  assert.equal(logout.status, 200);
  const signedOut = await worker.fetch(new Request(origin + "/api/auth/me", { headers }), env);
  assert.equal((await signedOut.json()).authenticated, false);
});

test("issue requires a recent session, replacement and revocation invalidate the previous code", async t => {
  const { DB, session, post } = fixture(t);
  assert.equal((await post("issue")).status, 401);
  assert.equal((await post("issue", { token: session, from: "https://elsewhere.test" })).status, 403);
  const { code: first } = await (await post("issue", { token: session })).json();
  const { code: second } = await (await post("issue", { token: session })).json();
  assert.notEqual(first, second);
  assert.equal((await post("redeem", { code: first })).status, 401);
  const other = seedSession(DB, { id: "another", email: "other@example.test" });
  assert.equal((await post("revoke", { token: other })).status, 200);
  assert.equal(DB.sqlite.prepare("SELECT code_hash FROM account_recovery_codes").get().code_hash, hash(second));
  DB.sqlite.prepare("UPDATE sessions SET created_at = 1 WHERE token_hash = ?").run(hash(session));
  assert.equal((await post("issue", { token: session })).status, 403);
  assert.equal((await post("revoke", { token: session })).status, 200);
  assert.equal((await post("redeem", { code: second })).status, 401);
});

test("a failed transaction leaves the recovery code usable; disabled or limited access fails closed", async t => {
  const { DB, env, session, post } = fixture(t);
  env.BOR_ACCOUNT_RECOVERY_ENABLED = "false";
  assert.equal((await post("issue", { token: session })).status, 404);
  env.BOR_ACCOUNT_RECOVERY_ENABLED = "true";
  env.CHAT_LIMITER.limit = async () => ({ success: false });
  assert.equal((await post("issue", { token: session })).status, 429);
  env.CHAT_LIMITER.limit = async () => ({ success: true });
  const { code } = await (await post("issue", { token: session })).json();
  DB.sqlite.exec("CREATE TRIGGER prevent_consume BEFORE DELETE ON account_recovery_codes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.equal((await post("redeem", { code })).status, 503);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 1);
  DB.sqlite.exec("DROP TRIGGER prevent_consume");
  assert.equal((await post("redeem", { code })).status, 200);
});

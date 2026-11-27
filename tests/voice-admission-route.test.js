import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { sha256Hex } from "../src/http.js";

const origin = "https://app.getborai.com";
const route = origin + "/api/voice/admission/status";
const token = "synthetic-session";
const sessionCookie = "__Host-borai_session=" + token;

test("Voice readiness uses the app session and forwards only a private status GET", async () => {
  const hash = await sha256Hex(token);
  let calls = 0;
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /JOIN users ON users.id = sessions.user_id/);
        return {
          bind(sessionHash, now) {
            assert.ok(Number.isInteger(now));
            return { first: async () => sessionHash === hash ? { id: "synthetic-user" } : null };
          }
        };
      }
    },
    BOR_VOICE_STATUS: {
      async fetch(url, init) {
        calls++;
        assert.equal(url, "https://voice-status.internal/api/voice/session/status");
        assert.equal(init.method, "GET");
        assert.equal(init.headers, undefined);
        assert.equal(init.body, undefined);
        return Response.json({ state: "pilot_session_unconfirmed", privateField: "omitted" });
      }
    }
  };

  const guest = new Request(route, { headers: { "X-User-Id": "synthetic-user" } });
  assert.equal((await worker.fetch(guest, env)).status, 401);

  const forged = new Request(route, { headers: { Cookie: sessionCookie + "-forged" } });
  assert.equal((await worker.fetch(forged, env)).status, 401);

  const post = new Request(route, { method: "POST", headers: { Cookie: sessionCookie } });
  const blocked = await worker.fetch(post, env);
  assert.equal(blocked.status, 405);
  assert.equal(blocked.headers.get("Allow"), "GET");
  assert.equal(calls, 0);

  const request = new Request(route, { headers: { Cookie: sessionCookie } });
  const response = await worker.fetch(request, env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(data.authenticated, true);
  assert.equal(data.ready, false);
  assert.equal(data.sessionState, "pilot_session_unconfirmed");
  assert.equal(data.privateField, undefined);
  assert.equal(calls, 1);

  const unavailable = await worker.fetch(request, { DB: env.DB, BOR_VOICE_STATUS: {
    fetch: async () => Response.json({ state: "unexpected" })
  } });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).ready, false);
});

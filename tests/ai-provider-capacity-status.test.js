import test from "node:test";
import assert from "node:assert/strict";
import { seedSession, startHarness } from "./e2e/harness.js";

// All errors are synthetic; no live provider, Cloudflare or paid calls.
test("English/Indonesian users see actionable and sanitized provider quota/capacity errors", async t => {
  const app = await startHarness({ extraEnv: { BOR_TEXT_BACKUP_ENABLED: "false" } });
  t.after(() => app.close());
  const token = seedSession(app.db, { id: "global-quota-test", email: "test@example.invalid" });
  const cookie = "__Host-borai_session=" + token;
  const countMessages = () => app.db.sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n;
  const units = subject => app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE subject=?").get(subject)?.units ?? 0;
  async function request(language) {
    return fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url, Cookie: cookie },
      body: JSON.stringify({ message: "simple synthetic ping", agent: "coordinator", language })
    });
  }
  app.env.AI.run = async () => { throw Object.assign(new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL"), { code: 3036, status: 429 }); };
  const en = await request("en");
  const enBody = await en.json();
  assert.equal(en.status, 503);
  assert.equal(enBody.code, "ai_daily_allocation_exhausted");
  assert.equal(enBody.stage, "ai_generation");
  assert.match(enBody.error, /daily reset/i);
  assert.ok(Number(en.headers.get("Retry-After")) >= 1);
  assert.ok(Number(en.headers.get("Retry-After")) <= 86400);
  assert.doesNotMatch(JSON.stringify(enBody), /SYNTHETIC_PRIVATE_PROVIDER_DETAIL/);
  assert.notEqual(enBody.saved, true);

  const id = await request("id");
  assert.equal(id.status, 503);
  assert.match((await id.json()).error, /07.00 WIB/);

  // Generic 429 is not evidence of daily reset.
  app.env.AI.run = async () => { throw Object.assign(new Error("SYNTHETIC_PROVIDER_KEY"), { status: 429 }); };
  const busy = await request("en");
  assert.equal(busy.status, 503);
  const busyBody = await busy.json();
  assert.equal(busyBody.code, "ai_provider_busy");
  assert.doesNotMatch(busyBody.error, /daily reset/i);
  assert.equal(busy.headers.get("Retry-After"), "30");
  assert.doesNotMatch(JSON.stringify(busyBody), /SYNTHETIC_PROVIDER_KEY/);

  app.env.AI.run = async () => { throw Object.assign(new Error("provider throttled"), { code: 3040 }); };
  const capacity = await request("id");
  assert.equal(capacity.status, 503);
  assert.equal((await capacity.json()).code, "ai_provider_busy");

  // Unknown provider failure retains existing generic sanitized contract.
  app.env.AI.run = async () => { throw new Error("private outage, unclassified"); };
  const unknown = await request("en");
  assert.equal(unknown.status, 502);
  assert.equal((await unknown.json()).code, "ai_error");
  assert.equal(unknown.headers.get("Retry-After"), null);
  assert.equal(units("user:global-quota-test"), 0);
  assert.equal(units("global"), 0);
  assert.equal(countMessages(), 0);
});

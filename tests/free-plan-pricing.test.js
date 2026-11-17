import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pricing = readFileSync(new URL("../public/paket.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const limits = readFileSync(new URL("../src/daily-limits.js", import.meta.url), "utf8");

test("pricing presents Free, Basic and Pro, Free costs $0 / Rp0", () => {
  assert.match(pricing, /id="plan-free">Free</);
  assert.match(pricing, /id="plan-basic">Basic</);
  assert.match(pricing, /id="plan-pro">Pro</);
  assert.match(pricing, /US\$0/);
  assert.match(pricing, /Rp0/);
  assert.match(pricing, /US\$1,99/);
  assert.match(pricing, /US\$6,99/);
  assert.match(pricing, /href="\/\?plan=free#\/"/);
  assert.match(pricing, /tidak perlu kartu/i);
  assert.match(pricing, /belum dapat dibeli/i);
});

test("Free entry respects existing auth before entering Guest without checkout", () => {
  const boot = app.slice(app.indexOf("async function boot()"), app.indexOf('$(\"openEmailDraft\")'));
  const auth = boot.indexOf("if(me.authenticated)");
  const free = boot.indexOf('get("plan")==="free"');
  assert.ok(auth >= 0 && free > auth);
  assert.match(boot, /writeGuestFlag\(true\);currentUser=null;setState\(AppState.GUEST\);await enterChat\(\);loadGoogle\(\);return/);
  assert.doesNotMatch(boot, /midtrans|checkout|payment/i);
});

test("Free quotas are accurately described as units, not credits or tokens", () => {
  assert.match(limits, /guest:\s*15,\s*user:\s*150,\s*global:\s*1500/);
  assert.match(limits, /MULTI_AGENT_UNITS\s*=\s*3/);
  assert.match(pricing, /15 unit penggunaan per hari/);
  assert.match(pricing, /150 unit\/hari/);
  assert.match(pricing, /Unit harian bukan token dan bukan kredit berbayar/);
});

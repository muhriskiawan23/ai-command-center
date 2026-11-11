import test from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./e2e/harness.js";

test("halaman utama: CSP tanpa 'unsafe-inline' untuk skrip, dan tidak ada skrip inline di HTML", async () => {
  const app = await startHarness();
  const res = await fetch(app.url + "/");
  const csp = res.headers.get("content-security-policy") || "";
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
  assert.ok(scriptSrc.includes("'self'") && scriptSrc.includes("https://accounts.google.com/gsi/client"));
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), `script-src masih mengizinkan inline: ${scriptSrc}`);
  const styleSrc = /(?:^|;\s*)style-src ([^;]*)/.exec(csp)?.[1] ?? "";
  assert.ok(!styleSrc.includes("'unsafe-inline'"), `style-src masih mengizinkan inline: ${styleSrc}`);
  const imgSrc = /img-src ([^;]*)/.exec(csp)?.[1] ?? "";
  assert.ok(!/(^|\s)https:(\s|$)/.test(imgSrc), `img-src tidak boleh mengizinkan semua https: ${imgSrc}`);
  assert.ok(imgSrc.includes("https://*.googleusercontent.com"));
  assert.ok(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"));
  const html = await res.text();
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && body.trim());
  assert.equal(inline.length, 0, "HTML tidak boleh berisi skrip inline");
  assert.doesNotMatch(html, /\son\w+\s*=\s*["']/i, "tidak boleh ada event handler inline");
  await app.close();
});

test("SQL pembersihan sesi hanya menghapus sesi yang sudah kedaluwarsa (diuji pada SQLite nyata)", async () => {
  const { createD1, seedSession } = await import("./e2e/harness.js");
  const db = createD1();
  seedSession(db, { id: "u1", email: "a@b.c" });
  const now = Math.floor(Date.now() / 1000);
  db.sqlite.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES ('old1','u1',?,?)").run(now - 10, now - 100);
  db.sqlite.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES ('old2','u1',?,?)").run(now - 1, now - 100);
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  const left = db.sqlite.prepare("SELECT token_hash FROM sessions").all();
  assert.equal(left.length, 1);
  assert.ok(!["old1", "old2"].includes(left[0].token_hash));
});

test("skrip CDN statis di index.html memakai SRI + crossorigin", async () => {
  const app = await startHarness();
  const html = await (await fetch(app.url + "/")).text();
  const cdn = [...html.matchAll(/<script\b[^>]*src="https:\/\/cdn\.[^"]+"[^>]*>/gi)].map(m => m[0]);
  assert.ok(cdn.length >= 2);
  for (const tag of cdn) {
    assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]+"/, tag);
    assert.match(tag, /crossorigin="anonymous"/, tag);
  }
  await app.close();
});

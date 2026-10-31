import { test, expect } from "./fixtures.js";

// Memastikan fungsi markdown() sungguhan tidak mengeksekusi HTML/URL berbahaya, baik dari jawaban AI maupun dari pesan pengguna.
const PAYLOAD = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1</script>',
  '<svg onload="window.__xss=1"></svg>',
  '[klik](javascript:window.__xss=1)',
  '**tebal** `kode`',
  '```html',
  '<img src=x onerror="window.__xss=1">',
  '```'
].join("\n");

test("HTML dan tautan berbahaya dari jawaban AI maupun pesan pengguna ditampilkan sebagai teks, tidak dieksekusi", async ({ page, app }) => {
  app.control.aiText = PAYLOAD;
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill(PAYLOAD);
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const dom = await page.evaluate(() => ({
    injected: document.querySelectorAll(".message-body img, .message-body script, .message-body svg, .message-body iframe").length,
    jsLinks: [...document.querySelectorAll("a")].filter((a) => /^\s*javascript:/i.test(a.getAttribute("href") || "")).length,
    handlers: [...document.querySelectorAll(".message-body *")].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length
  }));
  expect(dom).toEqual({ injected: 0, jsLinks: 0, handlers: 0 });
  await expect(page.locator(".message.assistant .message-body strong")).toContainText("tebal");   // markdown aman tetap bekerja
  await expect(page.locator(".message.assistant .message-body")).toContainText("<img src=x");       // tampil sebagai teks
});

test("header keamanan halaman: CSP, nosniff, anti-framing, referrer policy", async ({ page, app }) => {
  const res = await page.request.get(app.url + "/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBeTruthy();
  const api = await page.request.get(app.url + "/api/health");
  expect(api.headers()["cache-control"]).toContain("no-store");
});

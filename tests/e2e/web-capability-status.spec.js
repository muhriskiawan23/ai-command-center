import { test, expect } from "./fixtures.js";

// Offline browser regression. The default harness has neither Tavily credentials
// nor live third-party web access. Nothing here triggers provider spending.
test("Plugins clearly distinguishes Search, URL Reader and unavailable Web Actions", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  if (page.viewportSize().width <= 1024) await page.locator("#menuBtn").click();
  await expect(page.locator("#openPlugins")).toBeVisible();
  await page.locator("#openPlugins").click();
  await expect(page.locator("#pluginReaderStatus")).toHaveText("Belum tersedia");
  await expect(page.locator("#pluginReaderMeta")).toContainText("Pencarian web dapat tetap berfungsi");
  await expect(page.locator("#pluginCatalog")).toContainText("Web Actions");
  await expect(page.locator("#pluginCatalog")).toContainText("Belum tersedia");
  await expect(page.locator("#pluginSearchStatus")).toHaveText("Not configured");
});

test("When a link was not read, chat lists its failed read instead of calling it a read source", async ({ page, app }) => {
  app.control.aiText = "Halaman di tautan tersebut tidak saya akses. Tempelkan teksnya supaya bisa saya rangkum berdasarkan konten.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill("Ringkas https://example.com/public-page");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".message.assistant .sources")).toContainText("Sumber dan status pembacaan:");
  await expect(page.locator(".message.assistant .sources")).toContainText("Pembacaan tautan belum tersedia");
  await expect(page.locator(".message.assistant .sources .source.ok")).toHaveCount(0);
  expect(app.aiCalls.length).toBe(1);
});

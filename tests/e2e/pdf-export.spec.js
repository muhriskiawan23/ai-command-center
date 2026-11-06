import { test, expect } from "./fixtures.js";

test("an individual answer can be opened in a local print view for PDF saving", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();

  await page.locator("#prompt").fill("Jelaskan ringkas manfaat analisis data.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);

  const popupPromise = page.waitForEvent("popup");
  await page.locator(".message.assistant .print-message").click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toContainText("Jawaban BOR AI");
  await expect(popup.locator("body")).toContainText("Balasan uji untuk pesan Anda");
  await expect(popup.locator("body")).toContainText("Save as PDF");
  await popup.close();
});

test("the complete conversation can be opened in a local print view", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();

  await page.locator("#prompt").fill("Buat ringkasan singkat tentang kopi.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator("#printConversation")).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.locator("#printConversation").click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toContainText("BOR AI");
  await expect(popup.locator("body")).toContainText("Buat ringkasan singkat tentang kopi.");
  await expect(popup.locator("body")).toContainText("Balasan uji untuk pesan Anda");
  await popup.close();
});

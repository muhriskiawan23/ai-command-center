import { test, expect, drawerMode } from "./fixtures.js";

test("email draft helper prepares a Writer prompt without sending automatically", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();

  if (drawerMode(page)) {
    await page.locator("#menuBtn").click();
    await expect(page.locator("#sidebar")).toBeVisible();
  }
  await page.locator("#openPlugins").click();
  await expect(page.locator("#pluginsDialog")).toBeVisible();
  await page.locator("#pluginEmailUse").click();
  const panel = page.locator("#emailDraftPanel");
  await expect(panel).toBeVisible();
  await panel.locator("#emailPurpose").fill("Meminta jadwal ulang rapat proyek");
  await panel.locator("#emailRecipient").fill("Tim proyek");
  await panel.locator("#emailSubject").fill("Penjadwalan ulang rapat");
  await panel.locator("#emailPoints").fill("Usulkan Kamis pagi; minta konfirmasi");
  await panel.locator("#emailTone").selectOption("profesional");
  await panel.locator("#prepareEmailDraft").click();

  await expect(panel).toBeHidden();
  await expect(page.locator("#agent")).toHaveValue("writer");
  await expect(page.locator("#prompt")).toHaveValue(/Meminta jadwal ulang rapat proyek/);
  await expect(page.locator("#prompt")).toHaveValue(/Jangan mengirim email/);
  await expect(page.locator("#send")).toBeEnabled();
});

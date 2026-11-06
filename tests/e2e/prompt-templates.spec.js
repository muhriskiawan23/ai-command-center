import { test, expect } from "./fixtures.js";

test("guest can search and insert an editable prompt template without auto-submitting", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
  if (page.viewportSize().width <= 1024) await page.locator("#menuBtn").click();
  await page.locator("#openTemplates").click();
  const dialog = page.locator("#templatesDialog");
  await expect(dialog).toBeVisible();
  await page.locator("#templateSearch").fill("analisis kritis");
  const card = page.locator(".template-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Analisis kritis");
  await card.getByRole("button", { name: "Gunakan template" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#prompt")).toHaveValue(/Analisis secara kritis/);
  expect(app.aiCalls).toHaveLength(0);
});

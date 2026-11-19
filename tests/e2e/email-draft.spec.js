import { test, expect } from "./fixtures.js";

test("removed Email and My images shortcuts are not shown in Tools", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#toolsMenu > summary").click();

  await expect(page.locator("#openEmailDraft")).toHaveCount(0);
  await expect(page.locator("#openImageGallery")).toHaveCount(0);
  await expect(page.locator("#toolsMenu")).not.toContainText("My images");
  await expect(page.locator("#toolsMenu")).not.toContainText("Email");
});

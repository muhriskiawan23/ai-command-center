import { test, expect } from "./fixtures.js";

async function enterGuest(page, app) {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
}

test("CSV is parsed in the browser and only bounded derived context reaches chat", async ({ page, app }) => {
  await enterGuest(page, app);
  const rawCsv = "Product,Revenue\nCoffee,120000\nTea,80000";
  await page.locator("#csvFile").setInputFiles({
    name: "sales.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(rawCsv, "utf8")
  });
  await expect(page.locator("#csvAttachment")).toBeVisible();
  await expect(page.locator("#csvName")).toContainText("sales.csv");
  await page.locator("#prompt").fill("Ringkas pendapatan di file ini.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".csv-source")).toContainText("sales.csv");
  expect(app.aiCalls).toHaveLength(1);
  const userMessage = app.aiCalls[0].messages.find(message => message.role === "user")?.content || "";
  expect(userMessage).toContain("<csv_document");
  expect(userMessage).toContain("rata-rata=100000");
  expect(userMessage).toContain("Coffee");
  expect(userMessage).not.toContain("Product,Revenue\nCoffee,120000\nTea,80000");
});

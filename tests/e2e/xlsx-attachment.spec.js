import { test, expect } from "./fixtures.js";

async function enterGuest(page, app) {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
}

test("Excel workbook is parsed locally and only bounded derived context reaches chat", async ({ page, app }) => {
  await page.route("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", route => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.XLSX = {
      read: () => ({ SheetNames: ["Budget"], Sheets: { Budget: {
        "!ref": "A1:B3",
        A1: { v: "Item", t: "s" }, B1: { v: "Amount", t: "s" },
        A2: { v: "Coffee", t: "s" }, B2: { v: 120000, w: "120,000", t: "n" },
        A3: { v: "Tea", t: "s" }, B3: { v: 80000, w: "80,000", t: "n" }
      } } }),
      utils: {
        decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 2, c: 1 } }),
        encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1)
      }
    };`
  }));
  await enterGuest(page, app);
  const rawBytes = "RAW_XLSX_BYTES_MUST_STAY_IN_BROWSER_123456";
  await page.locator("#xlsxFile").setInputFiles({
    name: "budget.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(rawBytes, "utf8")
  });
  await expect(page.locator("#xlsxAttachment")).toBeVisible();
  await expect(page.locator("#xlsxName")).toContainText("budget.xlsx");
  await page.locator("#prompt").fill("Analisis total pendapatan di workbook ini.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".csv-source")).toContainText("budget.xlsx");
  expect(app.aiCalls).toHaveLength(1);
  const userMessage = app.aiCalls[0].messages.find(message => message.role === "user")?.content || "";
  expect(userMessage).toContain("<spreadsheet_document");
  expect(userMessage).toContain("average=100,000");
  expect(userMessage).toContain("Coffee");
  expect(userMessage).not.toContain(rawBytes);
});

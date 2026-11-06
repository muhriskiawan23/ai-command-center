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
  expect(userMessage).toContain("<spreadsheet_document");
  expect(userMessage).toContain("rata-rata=100000");
  expect(userMessage).toContain("Coffee");
  expect(userMessage).not.toContain("Product,Revenue\nCoffee,120000\nTea,80000");
});


test("Excel workbook is parsed locally and only bounded derived context reaches chat", async ({ page, app }) => {
  const fakeLibrary = `window.XLSX = {
    read: () => ({ SheetNames: ["Penjualan"], Sheets: { Penjualan: {
      "!ref": "A1:B2", A1: {v:"Produk"}, B1: {v:"Nilai"}, A2: {v:"Kopi"}, B2: {v:42}
    } } }),
    utils: {
      decode_range: () => ({s:{r:0,c:0},e:{r:1,c:1}}),
      encode_cell: ({r,c}) => String.fromCharCode(65+c) + (r+1),
      sheet_to_json: sheet => [[sheet.A1.v,sheet.B1.v],[sheet.A2.v,sheet.B2.v]]
    }
  };`;
  await page.route("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", route =>
    route.fulfill({ contentType: "application/javascript", body: fakeLibrary })
  );
  await enterGuest(page, app);
  await page.locator("#csvFile").setInputFiles({
    name: "sales.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
  });
  await expect(page.locator("#csvAttachment")).toBeVisible();
  await expect(page.locator("#csvName")).toContainText("sales.xlsx");
  await page.locator("#prompt").fill("Analisis file Excel ini.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  expect(app.aiCalls).toHaveLength(1);
  const userMessage = app.aiCalls[0].messages.find(message => message.role === "user")?.content || "";
  expect(userMessage).toContain("<spreadsheet_document");
  expect(userMessage).toContain("Sheet: Penjualan");
  expect(userMessage).toContain("Kopi");
  expect(userMessage).not.toContain("PK");
});

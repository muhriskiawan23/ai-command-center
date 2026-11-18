import { test, expect } from "./fixtures.js";

test("BOR AI proposes usable Google Forms script without claiming account-level creation",async({page,app})=>{
  app.control.aiText="Berikut rancangan survei masukan untuk BOR AI. Jalankan script setelah kamu meninjaunya.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#prompt")).toBeVisible();
  await page.locator("#prompt").fill("Buatkan formulir feedback dan saran publik untuk BOR AI");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  const panel=page.locator(".message.assistant .form-draft");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Belum dibuat di Google");
  await expect(panel.getByRole("button",{name:"Salin Google Apps Script"})).toBeVisible();
  await expect(panel.getByRole("link",{name:"Buka Google Apps Script"})).toHaveAttribute("href","https://script.google.com/home/projects/create");
  expect(app.aiCalls).toHaveLength(1);
});

test("ordinary chat does not fabricate a Google Forms tool or a web search",async({page,app})=>{
  app.control.aiText="Dua belas dikali empat belas sama dengan 168.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill("Berapa hasil 12 x 14?");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".form-draft")).toHaveCount(0);
  await expect(page.locator(".tool-activity")).toHaveCount(0);
});

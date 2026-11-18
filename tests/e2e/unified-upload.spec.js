import { test, expect } from "./fixtures.js";

test("single upload picker accepts JPG and sends only text extracted by local OCR", async({page,app})=>{
 await page.goto(app.url);await page.locator("#continueGuest").click();
 await expect(page.locator("#prompt")).toBeVisible();
 await page.evaluate(()=>{window.Tesseract={createWorker:async()=>({
   recognize:async()=>({data:{text:"Invoice total Rp 100.000"}}),
   terminate:async()=>{}
 })};});
 await page.locator("#attachmentMenu > summary").click();
 await expect(page.locator("#attachPdf")).toBeVisible();
 await expect(page.locator("#attachCsv")).toBeHidden();
 const chooser=page.waitForEvent("filechooser");
 await page.locator("#attachPdf").click();
 const fileChooser=await chooser;
 await fileChooser.setFiles({name:"invoice.jpg",mimeType:"image/jpeg",buffer:Buffer.from("fake-image-test")});
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#csvName")).toContainText("invoice.jpg");
 await page.locator("#prompt").fill("Berapakah total invoice berdasarkan OCR?");
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 const called=app.aiCalls.at(-1)?.messages||[];
 const sent=called.filter(m=>m.role==="user").at(-1).content;
 expect(sent).toContain("<image_ocr");
 expect(sent).toContain("Invoice total Rp 100.000");
 expect(sent).toMatch(/never claim to have inspected the actual pixels/i);
 await expect(page.locator(".image-ocr-source")).toBeVisible();
 await expect(page.locator(".image-ocr-source")).toContainText(/OCR/);
});

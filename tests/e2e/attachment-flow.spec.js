import {test,expect,loginAs} from "./fixtures.js";

const account={id:"attachment-style-tester",email:"attachments@example.test",name:"Attachment Tester"};
async function guest(page,app){await page.goto(app.url);await page.locator("#continueGuest").click();await expect(page.locator("#prompt")).toBeVisible();}
async function setTextImage(page,name="invoice.jpg"){
  await page.locator("#pdfFile").setInputFiles({name,mimeType:"image/jpeg",buffer:Buffer.from("image-pixels-test")});
}
async function setCsv(page){
  await page.locator("#pdfFile").setInputFiles({name:"sales.csv",mimeType:"text/csv",buffer:Buffer.from("Item,Price\nCoffee,120000\nTea,80000")});
}

test("attachment shows live OCR status, disables Send while reading, moves file into user bubble and clears composer",async({page,app})=>{
 await guest(page,app);
 await page.evaluate(()=>{
   window.Tesseract={createWorker:async()=>({
     recognize:async()=>{await new Promise(r=>setTimeout(r,350));return {data:{text:"Invoice total Rp 100.000"}};},
     terminate:async()=>{}
   })};
 });
 await setTextImage(page);
 await expect(page.locator("#attachmentPreview")).toBeVisible();
 await expect(page.locator("#pdfAttachment")).toBeVisible();
 await expect(page.locator("#attachmentProgress")).toContainText(/OCR|Membaca/);
 await expect(page.locator("#send")).toBeDisabled();
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#attachmentProgress")).toBeHidden();
 await page.locator("#prompt").fill("Berapakah nilai invoice?");
 await page.locator("#send").click();
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await expect(page.locator(".message.user .sent-file-card")).toContainText("invoice.jpg");
 await expect(page.locator(".message.user .message-text")).toContainText("Berapakah nilai invoice?");
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 expect(app.aiCalls.length).toBeGreaterThan(0);
 const aiUserMessage=app.aiCalls.at(-1).messages.filter(m=>m.role==="user").at(-1).content;
 expect(aiUserMessage).toContain("Invoice total Rp 100.000");
 expect(aiUserMessage).toContain("<image_ocr");
 expect(aiUserMessage).not.toContain("image-pixels-test");
});

test("file-only send persists safe filename card across signed-in account reload without uploading raw CSV",async({page,context,app})=>{
 await loginAs(context,app,account);
 await page.goto(app.url);
 await setCsv(page);
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#csvName")).toContainText("sales.csv");
 await expect(page.locator("#prompt")).toBeEmpty();
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await expect(page.locator(".message.user .sent-file-card")).toContainText("sales.csv");
 const stored=app.db.sqlite.prepare("SELECT content FROM messages WHERE role = 'user' LIMIT 1").get().content;
 expect(stored).toContain("[BORAI_FILE:sales.csv]");
 expect(stored).not.toContain("Coffee,120000");
 await page.reload();
 await expect(page.locator(".message.user .sent-file-card")).toContainText("sales.csv");
 await expect(page.locator(".message.user .message-text")).toContainText("Tolong analisis isi file terlampir.");
 await expect(page.locator("#attachmentPreview")).toBeHidden();
});

test("removing attachment during pending local OCR prevents late ghost file and unblocks chat",async({page,app})=>{
 await guest(page,app);
 await page.evaluate(()=>{
   window.Tesseract={createWorker:async()=>({
     recognize:()=>new Promise(resolve=>{window.__resolveOcr=resolve;}),
     terminate:async()=>{}
   })};
 });
 await setTextImage(page,"slow.jpg");
 await expect(page.locator("#pdfAttachment")).toBeVisible();
 await expect(page.locator("#send")).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>typeof window.__resolveOcr)).toBe("function");
 await page.locator("#clearPdf").click();
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await page.evaluate(()=>window.__resolveOcr({data:{text:"Late OCR result should be discarded"}}));
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await page.locator("#prompt").fill("halo");
 await expect(page.locator("#send")).toBeEnabled();
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 expect(app.aiCalls.at(-1).messages.filter(m=>m.role==="user").at(-1).content).not.toContain("<image_ocr");
});

test("retry after AI provider error reuses extracted file context even after composer chip has been cleared",async({page,app})=>{
 await guest(page,app);
 await setCsv(page);
 await expect(page.locator("#csvAttachment")).toBeVisible();
 app.control.aiFail=true;
 await page.locator("#prompt").fill("Ringkas angka penjualan pada dokumen ini.");
 await page.locator("#send").click();
 await expect(page.locator(".message.failed")).toBeVisible();
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await expect(page.locator(".message.user .sent-file-card")).toContainText("sales.csv");
 app.control.aiFail=false;
 await page.locator(".retry-btn").click();
 await expect(page.locator(".message.assistant:not(#typing):not(.failed)")).toHaveCount(1);
 const user=app.aiCalls.at(-1).messages.filter(m=>m.role==="user").at(-1).content;
 expect(user).toContain("<spreadsheet_document");
 expect(user).toContain("Coffee");
 await expect(page.locator("#attachmentPreview")).toBeHidden();
});

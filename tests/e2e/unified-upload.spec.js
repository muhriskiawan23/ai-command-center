import { test, expect } from "./fixtures.js";

test("single upload picker accepts real JPG and answers with visual understanding", async({page,app})=>{
 await page.goto(app.url);
 await page.locator("#continueGuest").click();
 await expect(page.locator("#prompt")).toBeVisible();
 // Real photo pixels, unlike the former OCR test's fake text buffer.
 const jpegBase64=await page.evaluate(()=>{
   const canvas=document.createElement("canvas");canvas.width=72;canvas.height=72;
   const context=canvas.getContext("2d");
   context.fillStyle="#ffffff";context.fillRect(0,0,72,72);
   context.fillStyle="#0000ff";context.fillRect(20,20,30,30);
   return canvas.toDataURL("image/jpeg",0.85).split(",")[1];
 });
 await page.locator("#attachmentMenu > summary").click();
 await expect(page.locator("#attachPdf")).toBeVisible();
 await expect(page.locator("#attachCsv")).toBeHidden();
 const chooser=page.waitForEvent("filechooser");
 await page.locator("#attachPdf").click();
 const fileChooser=await chooser;
 await fileChooser.setFiles({name:"invoice.jpg",mimeType:"image/jpeg",buffer:Buffer.from(jpegBase64,"base64")});
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#csvName")).toContainText("invoice.jpg");
 await expect(page.locator("#attachmentProgress")).toBeHidden();
 await page.locator("#prompt").fill("Apa yang ada di foto ini?");
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 const vision=app.aiCalls.find(x=>x.task==="query");
 expect(vision).toBeTruthy();
 expect(vision.image).toMatch(/^data:image\/jpeg;base64,/);
 const called=app.aiCalls.at(-1)?.messages||[];
 const sent=called.filter(m=>m.role==="user").at(-1).content;
 expect(sent).toContain("<image_visual_observation>");
 expect(sent).toContain("kotak biru");
 expect(sent).not.toContain(vision.image);
 await expect(page.locator(".image-ocr-source")).toHaveCount(0);
 await expect(page.locator(".message.user .sent-file-card")).toContainText("invoice.jpg");
});

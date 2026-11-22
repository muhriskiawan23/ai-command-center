import {test,expect,loginAs} from "./fixtures.js";

const account={id:"attachment-style-tester",email:"attachments@example.test",name:"Attachment Tester"};
async function guest(page,app){await page.goto(app.url);await page.locator("#continueGuest").click();await expect(page.locator("#prompt")).toBeVisible();}
async function setTextImage(page,name="invoice.jpg"){
  // The actual input is disabled while chat/session history is loading.
  // Programmatically dispatching a change before readiness silently drops the
  // file via uploadAnyFile's busy/loadingChat guard and flakes on slow tablets.
  await expect(page.locator("#prompt")).toBeVisible();
  await expect(page.locator("#pdfFile")).toBeEnabled();
  // Construct a real JPEG using the browser itself: no paid vision model or network.
  await page.evaluate(async filename => {
    const canvas=document.createElement("canvas");
    canvas.width=80;canvas.height=80;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="white";ctx.fillRect(0,0,80,80);
    ctx.fillStyle="blue";ctx.fillRect(15,15,50,50);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.85));
    const image=new File([blob],filename,{type:"image/jpeg"});
    const transfer=new DataTransfer();
    transfer.items.add(image);
    const input=document.getElementById("pdfFile");
    input.files=transfer.files;
    input.dispatchEvent(new Event("change",{bubbles:true}));
  },name);
}
async function setCsv(page){
  await expect(page.locator("#prompt")).toBeVisible();
  await expect(page.locator("#pdfFile")).toBeEnabled();
  await page.locator("#pdfFile").setInputFiles({name:"sales.csv",mimeType:"text/csv",buffer:Buffer.from("Item,Price\nCoffee,120000\nTea,80000")});
}

test("image attachment is resized locally, sent on submit to vision model, and shown in chat bubble",async({page,app})=>{
 await guest(page,app);
 await setTextImage(page);
 await expect(page.locator("#attachmentPreview")).toBeVisible();
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#attachmentProgress")).toBeHidden();
 await page.locator("#prompt").fill("Apa isi foto ini?");
 await page.locator("#send").click();
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await expect(page.locator(".message.user .sent-file-card")).toContainText("invoice.jpg");
 await expect(page.locator(".message.user .message-text")).toContainText("Apa isi foto ini?");
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 const vision=app.aiCalls.find(call=>call.task==="query");
 expect(vision).toBeTruthy();
 expect(vision.image).toMatch(/^data:image\/jpeg;base64,/);
 expect(vision.question).toContain("Apa isi foto ini?");
 const userText=app.aiCalls.at(-1).messages.filter(m=>m.role==="user").at(-1).content;
 expect(userText).toContain("<image_visual_observation>");
 expect(userText).toContain("kotak biru");
 expect(userText).not.toContain(vision.image);
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

test("removing an image before Send prevents raw image transmission and leaves chat usable",async({page,app})=>{
 await guest(page,app);
 await setTextImage(page,"removed.jpg");
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#attachmentProgress")).toBeHidden();
 await page.locator("#clearCsv").click();
 await expect(page.locator("#attachmentPreview")).toBeHidden();
 await page.locator("#prompt").fill("halo");
 await expect(page.locator("#send")).toBeEnabled();
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 expect(app.aiCalls.some(call=>call.task==="query")).toBe(false);
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

test("signed-in photo conversation never stores image pixels in D1 chat messages",async({page,context,app})=>{
 await loginAs(context,app,account);
 await page.goto(app.url);
 await setTextImage(page,"blue.jpg");
 await expect(page.locator("#csvAttachment")).toBeVisible();
 await expect(page.locator("#attachmentProgress")).toBeHidden();
 await page.locator("#prompt").fill("Jelaskan gambar ini");
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 const saved=app.db.sqlite.prepare("SELECT role,content FROM messages ORDER BY id").all();
 expect(saved.map(x=>x.role)).toEqual(["user","assistant"]);
 expect(saved[0].content).toContain("[BORAI_FILE:blue.jpg]");
 for(const row of saved){
   expect(row.content).not.toContain("data:image/");
   expect(row.content).not.toContain("/9j/");
 }
});

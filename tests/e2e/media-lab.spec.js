// Local media editor smoke proof. No remote AI or real video upload.
import {test,expect} from "./fixtures.js";
import {readFileSync} from "node:fs";
const localIcon=readFileSync(new URL("../../public/icon-192.png",import.meta.url));
test("Media Lab loads as local offline tool with an honest pending-AI disclaimer",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  await expect(page.getByRole("heading",{name:/Studio foto/})).toBeVisible();
  await expect(page.getByText(/Belum aktif:/)).toBeVisible();
  await expect(page.locator("#downloadPhoto")).toBeDisabled();
  await expect(page.locator("#extractFrames")).toBeDisabled();
  await expect(page.getByText(/tidak dikirim ke server/)).toBeVisible();
});
test("user may apply a local photo effect and download PNG without any upload",async({page,app})=>{
  const mediaPosts=[];
  page.on("request",req=>{
    if(req.method()==="POST"&&req.url().includes("/media"))
      mediaPosts.push(req.url());
  });
  await page.goto(app.url+"/media-lab.html");
  await page.locator("#photoFile").setInputFiles({
    name:"local-icon.png",mimeType:"image/png",buffer:localIcon
  });
  await expect(page.locator("#photoStatus")).toContainText("Foto siap");
  await expect(page.locator("#downloadPhoto")).toBeEnabled();
  await page.locator("#photoEffect").selectOption("vintage");
  await page.locator("#brightness").fill("110");
  await expect(page.locator("#brightnessValue")).toHaveText("110%");
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#downloadPhoto").click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe("bor-ai-photo-effect.png");
  expect(mediaPosts).toEqual([]);
});
test("video tab refuses unsupported files without uploading them",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  await page.locator("#videoTab").click();
  await expect(page.locator("#videoWorkspace")).toBeVisible();
  await expect(page.locator("#photoWorkspace")).toBeHidden();
  await page.locator("#videoFile").setInputFiles({
    name:"suspicious.txt",mimeType:"text/plain",buffer:Buffer.from("no video")
  });
  await expect(page.locator("#extractFrames")).toBeDisabled();
  await expect(page.locator("#videoStatus")).toContainText("tidak didukung");
});
const shortVideo=readFileSync(new URL("../fixtures/media/short.webm",import.meta.url));
test("real local video yields five decoded frames and can be selected again",async({page,app})=>{
  const uploads=[];
  page.on("request",request=>{if(!["GET","HEAD"].includes(request.method()))uploads.push(request.url())});
  await page.goto(app.url+"/media-lab.html");
  await page.locator("#videoTab").click();
  for(let i=0;i<2;i++){
    await page.locator("#videoFile").setInputFiles({name:"short.webm",mimeType:"video/webm",buffer:shortVideo});
    await page.locator("#extractFrames").click();
    await expect(page.locator("#videoStatus")).toContainText("Lima frame berhasil");
    await expect(page.locator("#frameList img")).toHaveCount(5);
    expect(await page.locator("#frameList img").evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth===160))).toBe(true);
  }
  expect(uploads).toEqual([]);
});
test("changing selected video cancels pending extraction without stale frames or status",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  await page.locator("#videoTab").click();
  await page.locator("#videoFile").setInputFiles({name:"short.webm",mimeType:"video/webm",buffer:shortVideo});
  await page.evaluate(()=>{
    document.getElementById("extractFrames").click();
    const transfer=new DataTransfer();transfer.items.add(new File(["invalid"],"invalid.txt",{type:"text/plain"}));
    const input=document.getElementById("videoFile");input.files=transfer.files;input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#videoStatus")).toContainText("tidak didukung");
  await expect(page.locator("#extractFrames")).toBeDisabled();
  await page.locator("#videoFile").setInputFiles({name:"short.webm",mimeType:"video/webm",buffer:shortVideo});
  await page.locator("#extractFrames").click();
  await expect(page.locator("#videoStatus")).toContainText("Lima frame berhasil");
  await expect(page.locator("#frameList img")).toHaveCount(5);
});
test("bad photo replaces old preview with an empty canvas and disables export",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  await page.locator("#photoFile").setInputFiles({name:"valid.png",mimeType:"image/png",buffer:localIcon});
  await expect(page.locator("#downloadPhoto")).toBeEnabled();
  await page.locator("#photoFile").setInputFiles({name:"spoofed.png",mimeType:"image/png",buffer:Buffer.alloc(24)});
  await expect(page.locator("#downloadPhoto")).toBeDisabled();
  await expect(page.locator("#photoStatus")).not.toContainText("Foto siap");
  const pixels=await page.locator("#photoCanvas").evaluate(canvas=>Array.from(canvas.getContext("2d").getImageData(0,0,1,1).data));
  expect(pixels).toEqual([10,16,32,255]);
});
test("media tabs support arrow keys and only the selected tab is in the tab order",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  await page.locator("#photoTab").focus();await page.keyboard.press("ArrowRight");
  await expect(page.locator("#videoTab")).toBeFocused();
  await expect(page.locator("#videoWorkspace")).toBeVisible();
  await expect(page.locator("#photoTab")).toHaveAttribute("tabindex","-1");
  await page.keyboard.press("Home");
  await expect(page.locator("#photoTab")).toBeFocused();
  await expect(page.locator("#photoWorkspace")).toBeVisible();
});

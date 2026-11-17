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

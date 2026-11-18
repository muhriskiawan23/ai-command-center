// Actual browser pixel decode/PNG encode; no remote upload or model calls.
import {test,expect} from "./fixtures.js";
import {readFileSync} from "node:fs";
import {normalizePngDataUri} from "../../src/png-preflight.js";
const fixture=name=>readFileSync(new URL("../fixtures/media/"+name,import.meta.url)).toString("base64");
test("JPEG/WebP/PNG prepare locally as valid PNG, then pass the real server decoder",async({page,app})=>{
  const uploads=[];
  page.on("request",request=>{if(!["GET","HEAD"].includes(request.method()))uploads.push(request.url())});
  await page.goto(app.url+"/media-lab.html");
  for(const [name,mime] of [["still.jpg","image/jpeg"],["still.webp","image/webp"],["filters-color-6.png","image/png"]]){
    const result=await page.evaluate(async({bytes,mime})=>{
      const {normalizeImageForUpload}=await import("/media-upload.js");
      const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],"source",{type:mime});
      const before=file.size;const output=await normalizeImageForUpload(file);
      return {...output,originalSize:file.size,before};
    },{bytes:fixture(name),mime});
    expect(result.mime).toBe("image/png");expect(result.width).toBe(64);expect(result.height).toBe(64);
    expect(result.uploaded).toBe(false);expect(result.originalSize).toBe(result.before);
    const verified=await normalizePngDataUri(result.dataUri);
    expect(verified.pixelCount).toBe(4096);
  }
  expect(uploads).toEqual([]);
});
test("browser preparation rejects spoofed files and honors cancellation",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  const result=await page.evaluate(async()=>{
    const {normalizeImageForUpload}=await import("/media-upload.js");
    const fake=new File(["<svg onload=alert(1) />"],"fake.png",{type:"image/png"});
    let rejected=false,cancelled=false;
    try{await normalizeImageForUpload(fake)}catch{rejected=true}
    const controller=new AbortController();controller.abort();
    try{await normalizeImageForUpload(fake,{signal:controller.signal})}catch(error){cancelled=error.name==="AbortError"}
    return {rejected,cancelled};
  });
  expect(result).toEqual({rejected:true,cancelled:true});
});
test("browser reference preparation respects the stricter sub-512 reference cap",async({page,app})=>{
  await page.goto(app.url+"/media-lab.html");
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement("canvas");canvas.width=800;canvas.height=600;
    const ctx=canvas.getContext("2d");ctx.fillStyle="#2479bd";ctx.fillRect(0,0,800,600);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    const {normalizeImageForUpload}=await import("/media-upload.js");
    return normalizeImageForUpload(new File([blob],"reference.png",{type:"image/png"}),{reference:true});
  });
  expect(result.width).toBe(511);expect(result.height).toBe(383);
  const verified=await normalizePngDataUri(result.dataUri);expect(verified.width).toBe(511);
});

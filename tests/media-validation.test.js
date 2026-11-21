import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateImageBytes,decodeImageDataUri} from "../public/media-validation.js";
import {pngBytes,pngDataUri,pngChunk} from "./helpers/media-fixtures.js";
import worker from "../src/index.js";
const fixture=name=>new Uint8Array(readFileSync(new URL("./fixtures/media/"+name,import.meta.url)));
test("real still PNG/JPEG/WebP pass bounded container validation",()=>{
  for(const [mime,bytes] of [["image/png",pngBytes()],["image/jpeg",fixture("still.jpg")],["image/webp",fixture("still.webp")]]) {
    assert.equal(validateImageBytes(bytes,mime).width,64);
    assert.equal(decodeImageDataUri(`data:${mime};base64,${Buffer.from(bytes).toString("base64")}`).height,64);
  }
});
test("PNG header-only, truncation, CRC corruption and appended payloads fail closed",()=>{
  const good=pngBytes(), broken=Buffer.from(good);broken[29]^=1;
  for(const bytes of [good.subarray(0,24),good.subarray(0,33),good.subarray(0,-12),broken,Buffer.concat([good,Buffer.from("<script>")])])
    assert.throws(()=>validateImageBytes(bytes,"image/png"),/PNG|byte/);
  // Correct chunk checksum is not enough: reject animation and unknown critical chunks.
  for(const chunk of [pngChunk("acTL",Buffer.alloc(8)),pngChunk("EVIL")])
    assert.throws(()=>validateImageBytes(Buffer.concat([good.subarray(0,33),chunk,good.subarray(33)]),"image/png"),/PNG/);
});
test("WebP RIFF size, chunk length, canvas mismatch, missing bitstream and animation are rejected",()=>{
  const good=Buffer.from(fixture("still.webp"));
  const wrongSize=Buffer.from(good);wrongSize.writeUInt32LE(good.length,4);
  const wrongChunk=Buffer.from(good);wrongChunk.writeUInt32LE(good.length+100,16);
  const headerOnly=Buffer.alloc(30);headerOnly.write("RIFF");headerOnly.writeUInt32LE(22,4);
  headerOnly.write("WEBPVP8X",8);headerOnly.writeUInt32LE(10,16);headerOnly[24]=63;headerOnly[27]=63;
  const animated=Buffer.from(headerOnly);animated[20]=2;
  const extended=Buffer.from(headerOnly);extended.writeUInt32LE(extended.length+good.length-12-8,4);
  extended[24]=127;
  for(const bytes of [wrongSize,wrongChunk,headerOnly,animated,Buffer.concat([extended,good.subarray(12)])])
    assert.throws(()=>validateImageBytes(bytes,"image/webp"),/WebP|byte/);
});
test("JPEG requires image scan, bounded segments and a complete end marker",()=>{
  const good=Buffer.from(fixture("still.jpg"));
  const noEnd=good.subarray(0,-2);
  const impossibleSegment=Buffer.from(good);impossibleSegment[4]=255;impossibleSegment[5]=255;
  const noScan=Buffer.concat([good.subarray(0,good.indexOf(Buffer.from([255,218]))),Buffer.from([255,217])]);
  for(const bytes of [noEnd,impossibleSegment,noScan])
    assert.throws(()=>validateImageBytes(bytes,"image/jpeg"),/JPEG/);
});
test("MIME substitution, noncanonical base64 and excessive dimensions are rejected",()=>{
  const png=pngDataUri();
  for(const uri of [png+"\n",png.replace("image/png","image/jpeg"),png.replace(/=+$/, "")])
    assert.throws(()=>decodeImageDataUri(uri),/JPEG|base64|URI/);
  assert.throws(()=>validateImageBytes(pngBytes({width:512}),"image/png",{maxWidth:511}),/dimensions/);
  assert.throws(()=>decodeImageDataUri(png,{maxBytes:10}),/oversized/);
});
test("Media Lab security policy permits local blob videos without opening external media hosts",async()=>{
  const response=await worker.fetch(new Request("https://borai.test/media-lab.html"),{
    ASSETS:{fetch:async()=>new Response("<html></html>",{headers:{"Content-Type":"text/html"}})}
  });
  const policy=response.headers.get("Content-Security-Policy");
  assert.equal(policy.split(";").map(d=>d.trim()).find(d=>d.startsWith("media-src")),"media-src 'self' blob:");
  assert.match(policy,/object-src 'none'/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deflateSync,inflateSync} from "node:zlib";
import {createHash} from "node:crypto";
import {normalizePngDataUri,createPngMediaPreflight,createPngOutputValidator} from "../src/png-preflight.js";
import {pngBytes,pngDataUri,pngChunk} from "./helpers/media-fixtures.js";
const fixture=name=>readFileSync(new URL("./fixtures/media/"+name,import.meta.url));
const manifest=JSON.parse(fixture("png-pixel-manifest.json"));
const uri=bytes=>"data:image/png;base64,"+Buffer.from(bytes).toString("base64");
const bytesOf=uri=>Buffer.from(uri.split(",")[1],"base64");
function chunks(bytes){
  const result=[];
  for(let pos=8;pos<bytes.length;){const size=bytes.readUInt32BE(pos);result.push({type:bytes.toString("ascii",pos+4,pos+8),data:bytes.subarray(pos+8,pos+8+size)});pos+=size+12;}
  return result;
}
function replaceData(bytes,data){
  return Buffer.concat([bytes.subarray(0,8),...chunks(bytes).map(c=>pngChunk(c.type,c.type==="IDAT"?data:c.data))]);
}
for(const [name,expected] of Object.entries(manifest)){
  test("real PNG pixels match independent Pillow reference: "+name,async()=>{
    const original=name==="repository-icon-192"?readFileSync(new URL("../public/icon-192.png",import.meta.url)):fixture(name);
    const output=await normalizePngDataUri(uri(original));const parts=chunks(bytesOf(output.dataUri));
    assert.deepEqual(parts.map(c=>c.type),["IHDR","IDAT","IEND"]);
    const raw=inflateSync(parts[1].data),stride=expected.width*expected.channels,rows=[];
    for(let y=0;y<expected.height;y++){
      assert.equal(raw[y*(stride+1)],0);
      rows.push(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    }
    assert.equal(createHash("sha256").update(Buffer.concat(rows)).digest("hex"),expected.pixelSha256);
    assert.equal(output.width,expected.width);assert.equal(output.height,expected.height);
    assert.equal(output.metadataStripped,true);
    assert.doesNotMatch(bytesOf(output.dataUri).toString("latin1"),/example@example.test|GPS/);
  });
}
test("a valid PNG envelope with broken zlib data is rejected by actual decoding",async()=>{
  await assert.rejects(normalizePngDataUri(uri(replaceData(pngBytes(),Buffer.from([1,2,3,4])))));
});
test("inflated byte counts must match dimensions exactly, including too little data",async()=>{
  const original=pngBytes();const expected=64*(64*3+1);
  for(const size of [expected-1,expected+1,2*1024*1024]){
    const corrupt=uri(replaceData(original,deflateSync(Buffer.alloc(size))));
    await assert.rejects(normalizePngDataUri(corrupt),/byte|limit|count/i);
  }
});
test("a corrupt zlib checksum is rejected even when PNG chunk CRC is correct",async()=>{
  const original=pngBytes(),data=Buffer.from(chunks(original).find(c=>c.type==="IDAT").data);data[data.length-1]^=1;
  await assert.rejects(normalizePngDataUri(uri(replaceData(original,data))));
});
test("invalid scanline filters are rejected",async()=>{
  const original=pngBytes(),raw=inflateSync(chunks(original).find(c=>c.type==="IDAT").data);raw[0]=5;
  await assert.rejects(normalizePngDataUri(uri(replaceData(original,deflateSync(raw)))),/filter/);
});
test("unsupported encoding/interlace/palette/transparency is refused without inventing decoder support",async()=>{
  const original=pngBytes();
  for(const mutate of [h=>{h[8]=16},h=>{h[12]=1}]){
    const h=Buffer.from(chunks(original)[0].data);mutate(h);
    const bytes=Buffer.concat([original.subarray(0,8),pngChunk("IHDR",h),...chunks(original).slice(1).map(c=>pngChunk(c.type,c.data))]);
    await assert.rejects(normalizePngDataUri(uri(bytes)),/encoding/);
  }
  const transparent=Buffer.concat([original.subarray(0,33),pngChunk("tRNS",Buffer.alloc(6)),original.subarray(33)]);
  await assert.rejects(normalizePngDataUri(uri(transparent)),/alpha/);
  for(const [name,mime] of [["still.jpg","image/jpeg"],["still.webp","image/webp"]])
    await assert.rejects(normalizePngDataUri("data:"+mime+";base64,"+fixture(name).toString("base64")),/PNG/);
});
test("metadata chunks are discarded without decompressing embedded text",async()=>{
  const original=pngBytes();const data=Buffer.concat([Buffer.from("Comment\0\0"),deflateSync(Buffer.alloc(2*1024*1024,65))]);
  const input=Buffer.concat([original.subarray(0,33),pngChunk("zTXt",data),original.subarray(33)]);
  const output=await normalizePngDataUri(uri(input));
  assert.deepEqual(chunks(bytesOf(output.dataUri)).map(c=>c.type),["IHDR","IDAT","IEND"]);
});
test("pixel cap and cancellation are enforced before expensive decoding",async()=>{
  await assert.rejects(normalizePngDataUri(pngDataUri({width:2049})),/dimensions/);
  await assert.rejects(normalizePngDataUri(pngDataUri(),{maxPixels:1024}),/dimensions/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(normalizePngDataUri(pngDataUri(),{signal:controller.signal}),/cancelled/);
});
test("PNG preflight decodes all references/frames sequentially under an aggregate pixel cap",async()=>{
  const image=pngDataUri(),request={action:"analyze_video_frames",input:{durationSeconds:10,
    question:"Jelaskan adegan ini",frames:[0,5].map(atSeconds=>({atSeconds,imageDataUri:image}))}};
  const preflight=createPngMediaPreflight({maxTotalPixels:8192});
  const result=await preflight({request});assert.equal(result.ok,true);assert.equal(result.pixelDecodeVerified,true);
  assert.deepEqual(result.request.input.frames.map(f=>f.atSeconds),[0,5]);
  assert.equal(result.request.input.question,request.input.question);assert.notEqual(result.request,request);
  assert.equal((await createPngMediaPreflight({maxTotalPixels:4096})({request})).ok,false);
  const edit={action:"edit_image",input:{prompt:"Ubah warna",references:[image,image]}};
  assert.equal((await preflight({request:edit})).ok,true);
});
test("actual decoder failures produce a closed preflight result rather than a pretend success",async()=>{
  const request={action:"describe_image",input:{imageDataUri:uri(replaceData(pngBytes(),Buffer.from("broken")))}};
  assert.deepEqual(await createPngMediaPreflight()({request}),{ok:false});
});
test("pixel decoding never substitutes for required independent content moderation",async()=>{
  assert.throws(()=>createPngOutputValidator(),/moderation/);
  const validate=createPngOutputValidator({moderate:async()=>({ok:false})});
  assert.deepEqual(await validate({output:{imageDataUri:pngDataUri()}}),{ok:false});
});

// Actual local Workers runtime, locked CLI, synthetic fixtures, no account/AI/DB.
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {inflateSync,deflateSync} from "node:zlib";
import {pngBytes,pngChunk} from "../helpers/media-fixtures.js";
import {spawn} from "node:child_process";
import net from "node:net";
const root=fileURLToPath(new URL("../../",import.meta.url));
const cli=join(root,"tests/billing/stage3-wrangler-lock/node_modules/wrangler/bin/wrangler.js");
const version=JSON.parse(readFileSync(join(root,"tests/billing/stage3-wrangler-lock/node_modules/wrangler/package.json"),"utf8")).version;
assert.equal(version,"4.160.0","only the existing locked Wrangler version may run this proof");
const socket=net.createServer();
await new Promise((resolve,reject)=>{socket.once("error",reject);socket.listen(0,"127.0.0.1",resolve)});
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const state=mkdtempSync(join(tmpdir(),"bor-ai-png-proof-"));
const env={PATH:process.env.PATH,HOME:process.env.HOME,CI:"true",WRANGLER_SEND_METRICS:"false",NO_COLOR:"1"};
const child=spawn(process.execPath,[cli,"dev","--local","--ip","127.0.0.1","--port",String(port),
  "--latest=false","--config",join(root,"tests/media/png-worker.jsonc"),"--persist-to",state],
  {cwd:root,env,stdio:["ignore","pipe","pipe"],detached:true});
let logs="",exited=false;child.once("exit",()=>{exited=true});
for(const stream of [child.stdout,child.stderr])stream.on("data",bytes=>{logs=(logs+bytes.toString()).slice(-4000)});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const url="http://127.0.0.1:"+port;
async function call(imageDataUri){
  return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({imageDataUri}),signal:AbortSignal.timeout(5000)});
}
function pngPixels(dataUri,expected){
  const bytes=Buffer.from(dataUri.split(",")[1],"base64"),parts=[];let compressed;
  for(let pos=8;pos<bytes.length;){const size=bytes.readUInt32BE(pos),type=bytes.toString("ascii",pos+4,pos+8);
    parts.push(type);if(type==="IDAT")compressed=bytes.subarray(pos+8,pos+8+size);pos+=size+12;}
  assert.deepEqual(parts,["IHDR","IDAT","IEND"]);
  const data=inflateSync(compressed),stride=expected.width*expected.channels,rows=[];
  for(let y=0;y<expected.height;y++){
    assert.equal(data[y*(stride+1)],0);rows.push(data.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
  }
  return createHash("sha256").update(Buffer.concat(rows)).digest("hex");
}
try{
  let ready=false;
  for(let i=0;i<150;i++){
    if(exited)throw new Error("Local Workers runtime exited: "+logs);
    try{await fetch(url,{signal:AbortSignal.timeout(300)});ready=true;break;}catch{}
    await wait(200);
  }
  assert.equal(ready,true,"local Workers runtime must start");
  const manifest=JSON.parse(readFileSync(join(root,"tests/fixtures/media/png-pixel-manifest.json"),"utf8"));
  let passed=0;
  for(const [name,expected] of Object.entries(manifest)){
    const bytes=readFileSync(name==="repository-icon-192"?join(root,"public/icon-192.png"):join(root,"tests/fixtures/media",name));
    const response=await call("data:image/png;base64,"+bytes.toString("base64"));
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(pngPixels(result.dataUri,expected),expected.pixelSha256);passed++;
  }
  const invalid=await call("data:image/png;base64,"+Buffer.alloc(24).toString("base64"));
  assert.equal(invalid.status,422);passed++;
  const original=pngBytes();
  for(const payload of [Buffer.from("broken zlib"),deflateSync(Buffer.alloc(2*1024*1024))]){
    const bytes=Buffer.concat([original.subarray(0,33),pngChunk("IDAT",payload),pngChunk("IEND")]);
    assert.equal((await call("data:image/png;base64,"+bytes.toString("base64"))).status,422);passed++;
  }
  console.log(JSON.stringify({scope:"local_workerd_png_decode",passed,failed:0,remoteCalls:0,aiCalls:0,dbWrites:0}));
}finally{
  try{process.kill(-child.pid,"SIGTERM")}catch{}
  for(let i=0;i<20&&!exited;i++)await wait(100);
  if(!exited){try{process.kill(-child.pid,"SIGKILL")}catch{}}
  rmSync(state,{recursive:true,force:true});
}

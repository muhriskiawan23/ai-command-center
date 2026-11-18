// Real, bounded pixel decoding/re-encoding for a deliberately narrow PNG
// subset. No network, storage, native Node APIs, external codec or AI call.
// Supported: 8-bit, noninterlaced grayscale/RGB/grayscale-alpha/RGBA.
import {decodeImageDataUri,validateImageBytes} from "../public/media-validation.js";
import {prepareMultimodalOperation} from "./multimodal-inference.js";
const MAX_PIXELS=4*1024*1024;
const MAX_BYTES=4*1024*1024;
const SIGNATURE=new Uint8Array([137,80,78,71,13,10,26,10]);
const CRC=Uint32Array.from({length:256},(_,n)=>{
  for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function cancelled(signal){if(signal?.aborted)throw new Error("PNG processing cancelled");}
function chunk(type,payload){
  const bytes=new Uint8Array(payload.length+12),view=new DataView(bytes.buffer);
  view.setUint32(0,payload.length);
  for(let i=0;i<4;i++)bytes[i+4]=type.charCodeAt(i);
  bytes.set(payload,8);let crc=0xffffffff;
  for(let i=4;i<bytes.length-4;i++)crc=CRC[(crc^bytes[i])&255]^(crc>>>8);
  view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);return bytes;
}
async function boundedStream(stream,limit,signal){
  const reader=stream.getReader(),parts=[];let total=0;
  let abort;
  const stopped=new Promise((_,reject)=>{
    abort=()=>{void reader.cancel().catch(()=>{});reject(new Error("PNG processing cancelled"));};
    signal?.addEventListener("abort",abort,{once:true});
  });
  try{
    cancelled(signal);
    while(true){
      const {done,value}=await Promise.race([reader.read(),stopped]);
      if(done)break;
      total+=value.byteLength;
      if(total>limit){void reader.cancel().catch(()=>{});throw new RangeError("PNG decoded/encoded bytes exceed limit");}
      parts.push(value);
    }
    const joined=new Uint8Array(total);let offset=0;
    for(const part of parts){joined.set(part,offset);offset+=part.length;}
    return joined;
  }catch(error){void reader.cancel().catch(()=>{});throw error;}
  finally{signal?.removeEventListener("abort",abort);reader.releaseLock();}
}
function paeth(a,b,c){
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}
function encodeUri(bytes){
  const parts=[];
  for(let i=0;i<bytes.length;i+=16384)parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
  return "data:image/png;base64,"+btoa(parts.join(""));
}
function compressedInput(parts){
  let index=0,offset=0;
  return new ReadableStream({pull(controller){
    while(index<parts.length&&offset===parts[index].length){index++;offset=0;}
    if(index===parts.length){controller.close();return;}
    // Avoid handing a whole compressed bomb to one native transform write.
    // Backpressure and bounded output reads stop expansion between small
    // input pieces rather than after a large Blob chunk has been inflated.
    const end=Math.min(parts[index].length,offset+256);
    controller.enqueue(parts[index].subarray(offset,end));offset=end;
  }});
}
export async function normalizePngDataUri(dataUri,{signal,maxPixels=MAX_PIXELS}={}){
  if(!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>MAX_PIXELS)throw new TypeError("Bounded PNG pixel limit required");
  cancelled(signal);
  const image=decodeImageDataUri(dataUri,{maxBytes:MAX_BYTES,maxWidth:2048,maxHeight:2048,maxPixels});
  if(image.mime!=="image/png")throw new TypeError("PNG pixel decoder requires PNG input");
  const {bytes,width,height}=image,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const color=bytes[25],channels=({0:1,2:3,4:2,6:4})[color];
  if(bytes[24]!==8||bytes[28]!==0||!channels)throw new TypeError("Unsupported PNG pixel encoding");
  const compressed=[];
  for(let pos=8;pos<bytes.length;){
    const size=view.getUint32(pos),type=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    // tRNS carries pixel transparency rather than disposable metadata. Do
    // not strip it and silently change the picture: require explicit alpha.
    if(type==="tRNS")throw new TypeError("PNG transparency must use an explicit alpha channel");
    if(type==="IDAT")compressed.push(bytes.subarray(pos+8,pos+8+size));
    pos+=size+12;
  }
  const stride=width*channels,rowBytes=stride+1,expected=rowBytes*height;
  const decoded=await boundedStream(compressedInput(compressed).pipeThrough(new DecompressionStream("deflate")),expected,signal);
  if(decoded.length!==expected)throw new TypeError("PNG scanline byte count differs from image dimensions");
  for(let y=0;y<height;y++){
    if(y%32===0){await new Promise(resolve=>setTimeout(resolve,0));cancelled(signal);}
    const start=y*rowBytes,filter=decoded[start];
    if(filter>4)throw new TypeError("Invalid PNG scanline filter");
    for(let x=0;x<stride;x++){
      const offset=start+1+x,a=x>=channels?decoded[offset-channels]:0;
      const b=y>0?decoded[offset-rowBytes]:0,c=y>0&&x>=channels?decoded[offset-rowBytes-channels]:0;
      const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
      decoded[offset]=(decoded[offset]+prediction)&255;
    }
    // Reuse the one bounded scanline buffer rather than allocating an RGBA
    // copy. Every output scanline uses filter 0 and the same pixel bytes.
    decoded[start]=0;
  }
  cancelled(signal);
  const encoded=await boundedStream(new Blob([decoded]).stream().pipeThrough(new CompressionStream("deflate")),MAX_BYTES-57,signal);
  const chunks=[SIGNATURE,chunk("IHDR",bytes.slice(16,29)),chunk("IDAT",encoded),chunk("IEND",new Uint8Array())];
  const result=new Uint8Array(chunks.reduce((sum,value)=>sum+value.length,0));let offset=0;
  for(const part of chunks){result.set(part,offset);offset+=part.length;}
  validateImageBytes(result,"image/png",{maxBytes:MAX_BYTES,maxWidth:2048,maxHeight:2048,maxPixels});
  cancelled(signal);
  return Object.freeze({dataUri:encodeUri(result),width,height,pixelCount:width*height,
    metadataStripped:true,pixelEncoding:"png-8bit-noninterlaced"});
}
export function createPngMediaPreflight({maxTotalPixels=MAX_PIXELS}={}){
  if(!Number.isSafeInteger(maxTotalPixels)||maxTotalPixels<1||maxTotalPixels>MAX_PIXELS)
    throw new TypeError("Bounded PNG aggregate pixel limit required");
  return async function preflight({request,signal}){
    try{
      prepareMultimodalOperation(request);cancelled(signal);
      const clean=structuredClone(request);let remaining=maxTotalPixels;
      const image=async uri=>{
        const normalized=await normalizePngDataUri(uri,{signal,maxPixels:remaining});
        remaining-=normalized.pixelCount;return normalized.dataUri;
      };
      if(clean.action==="describe_image")clean.input.imageDataUri=await image(clean.input.imageDataUri);
      if(Array.isArray(clean.input.references)){
        for(let i=0;i<clean.input.references.length;i++)clean.input.references[i]=await image(clean.input.references[i]);
      }
      if(Array.isArray(clean.input.frames)){
        for(const frame of clean.input.frames)frame.imageDataUri=await image(frame.imageDataUri);
      }
      prepareMultimodalOperation(clean);cancelled(signal);
      return {ok:true,request:clean,pixelDecodeVerified:true,metadataStripped:true};
    }catch{return {ok:false};}
  };
}
// Pixel verification and semantic/content moderation are separate controls.
// No fake "approved" default is installed; the caller must supply moderation.
export function createPngOutputValidator({moderate}={}){
  if(typeof moderate!=="function")throw new TypeError("Independent output moderation required");
  return async function validate({output,feature,signal}){
    try{
      cancelled(signal);
      const value=typeof output?.imageDataUri==="string"
        ?{...output,imageDataUri:(await normalizePngDataUri(output.imageDataUri,{signal})).dataUri}
        :output;
      const clean=Object.freeze({...value});
      const reviewed=await moderate({output:clean,feature,signal});cancelled(signal);
      return reviewed?.ok===true?{ok:true,output:clean}:{ok:false};
    }catch{return {ok:false};}
  };
}

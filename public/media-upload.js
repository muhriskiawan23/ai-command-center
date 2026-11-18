// Optional local-only preparation helper; it never uploads or stores a file.
// JPEG/WebP/PNG pixels are decoded by the browser and exported as bounded
// 8-bit PNG for the server's actual PNG decoder. Original files are untouched.
import {validateImageBytes} from "./media-validation.js";
const TYPES=new Set(["image/png","image/jpeg","image/webp"]);
const MAX_OUTPUT=4*1024*1024;
export async function normalizeImageForUpload(file,{reference=false,maxDimension=2048,signal}={}){
  if(!file||!TYPES.has(file.type)||file.size<1||file.size>8*1024*1024)
    throw new TypeError("Gunakan JPG, PNG, atau WebP maksimal 8 MB.");
  const bound=reference?511:2048;
  if(!Number.isSafeInteger(maxDimension)||maxDimension<32||maxDimension>2048)
    throw new TypeError("Batas dimensi gambar tidak valid.");
  const cap=Math.min(bound,maxDimension);
  let timer,url,image,canvas,abort;
  const stopped=new Promise((_,reject)=>{
    abort=()=>reject(new DOMException("Persiapan gambar dibatalkan.","AbortError"));
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(()=>reject(new Error("Persiapan gambar melewati batas waktu.")),10000);
  });
  const check=()=>{if(signal?.aborted)throw new DOMException("Persiapan gambar dibatalkan.","AbortError");};
  const wait=promise=>Promise.race([promise,stopped]);
  try{
    check();
    const bytes=new Uint8Array(await wait(file.arrayBuffer()));
    validateImageBytes(bytes,file.type,{maxBytes:8*1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:16*1024*1024});
    check();url=URL.createObjectURL(file);image=new Image();image.decoding="async";image.src=url;
    await wait(image.decode());check();
    if(image.naturalWidth<32||image.naturalHeight<32||image.naturalWidth>8192||image.naturalHeight>8192||
      image.naturalWidth*image.naturalHeight>16*1024*1024)throw new RangeError("Dimensi gambar tidak didukung.");
    let scale=Math.min(1,cap/image.naturalWidth,cap/image.naturalHeight);
    canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx)throw new Error("Dekoder gambar perangkat tidak tersedia.");
    for(let attempt=0;attempt<6;attempt++){
      canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
      if(canvas.width<32||canvas.height<32)throw new RangeError("Sisi pendek gambar terlalu kecil setelah normalisasi.");
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await wait(new Promise(resolve=>canvas.toBlob(resolve,"image/png")));check();
      if(!blob)throw new Error("Gambar tidak dapat diekspor sebagai PNG.");
      if(blob.size<=MAX_OUTPUT){
        const output=new Uint8Array(await wait(blob.arrayBuffer()));check();
        const info=validateImageBytes(output,"image/png",{maxBytes:MAX_OUTPUT,maxWidth:cap,maxHeight:cap,maxPixels:4*1024*1024});
        const parts=[];
        for(let i=0;i<output.length;i+=16384)parts.push(String.fromCharCode(...output.subarray(i,i+16384)));
        return Object.freeze({dataUri:"data:image/png;base64,"+btoa(parts.join("")),width:info.width,height:info.height,
          mime:"image/png",originalUnchanged:true,uploaded:false});
      }
      scale*=.75;
    }
    throw new RangeError("Gambar masih terlalu besar setelah normalisasi.");
  }finally{
    clearTimeout(timer);signal?.removeEventListener("abort",abort);
    if(image)image.src="";
    if(url)URL.revokeObjectURL(url);
    if(canvas){canvas.width=1;canvas.height=1;}
  }
}

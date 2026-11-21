// Shared browser/Worker preflight. Checks the bounded container structure,
// not the compressed pixel stream. A successful bounded decoder/re-encode is
// still required before enabling future server-side media inference.
const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const text = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
function invalid(format) { throw new TypeError("Invalid or unsupported " + format + " image container"); }
const CRC_TABLE = Uint32Array.from({length:256}, (_, n) => {
  for(let k=0;k<8;k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes, start, end) {
  let crc=0xffffffff;
  for(let i=start;i<end;i++) crc=CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngDimensions(bytes, view) {
  if(![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) invalid("PNG");
  let pos=8, width=0, height=0, data=false, closedData=false, chunks=0, palette=false;
  while(pos+12<=bytes.length) {
    if(++chunks>4096) invalid("PNG");
    const size=view.getUint32(pos), type=text(bytes,pos+4,pos+8), end=pos+12+size;
    if(end>bytes.length || !/^[A-Za-z]{4}$/.test(type) ||
       crc32(bytes,pos+4,end-4)!==view.getUint32(end-4)) invalid("PNG");
    if(pos===8) {
      if(type!=="IHDR" || size!==13) invalid("PNG");
      width=view.getUint32(pos+8); height=view.getUint32(pos+12);
      const depth=bytes[pos+16], color=bytes[pos+17];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!depths[color]?.includes(depth) || bytes[pos+18]!==0 || bytes[pos+19]!==0 || bytes[pos+20]>1) invalid("PNG");
    } else if(type==="IHDR" || ["acTL","fcTL","fdAT"].includes(type)) invalid("PNG");
    else if(type==="PLTE") {
      if(palette || data || size<3 || size>768 || size%3) invalid("PNG");
      palette=true;
    } else if(type==="IDAT") {
      if(closedData || (bytes[25]===3 && !palette)) invalid("PNG");
      if(size>0) data=true;
    } else if(type==="IEND") {
      if(size!==0 || !data || end!==bytes.length) invalid("PNG");
      return {width,height};
    } else if(type[0]===type[0].toUpperCase()) invalid("PNG");
    if(data && type!=="IDAT") closedData=true;
    pos=end;
  }
  invalid("PNG");
}
function jpegDimensions(bytes, view) {
  if(bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217) invalid("JPEG");
  let pos=2, width=0, height=0;
  while(pos+4<bytes.length) {
    if(bytes[pos++]!==255) invalid("JPEG");
    while(bytes[pos]===255) pos++;
    const marker=bytes[pos++];
    if(pos+2>bytes.length) invalid("JPEG");
    const size=view.getUint16(pos), end=pos+size;
    if(size<2 || end>bytes.length-2) invalid("JPEG");
    if(marker===0xc0 || marker===0xc1 || marker===0xc2) {
      if(width || size<11 || size!==8+3*bytes[pos+7] || bytes[pos+2]!==8) invalid("JPEG");
      height=view.getUint16(pos+3); width=view.getUint16(pos+5);
    } else if(marker===0xda) {
      if(!width || size<8 || size!==6+2*bytes[pos+2] || end>=bytes.length-2) invalid("JPEG");
      return {width,height};
    } else if(marker===0xd8 || marker===0xd9 || marker===0 || (marker>=0xd0 && marker<=0xd7)) invalid("JPEG");
    pos=end;
  }
  invalid("JPEG");
}
function webpDimensions(bytes, view) {
  if(text(bytes,0,4)!=="RIFF" || text(bytes,8,12)!=="WEBP" || view.getUint32(4,true)+8!==bytes.length) invalid("WebP");
  let pos=12, canvas=null, image=null, chunks=0;
  while(pos+8<=bytes.length) {
    if(++chunks>4096) invalid("WebP");
    const type=text(bytes,pos,pos+4), size=view.getUint32(pos+4,true), start=pos+8, end=start+size;
    if(end+(size&1)>bytes.length || ((size&1) && bytes[end]!==0)) invalid("WebP");
    if(type==="ANIM" || type==="ANMF") invalid("animated WebP");
    if(type==="VP8X") {
      if(pos!==12 || size!==10 || canvas || (bytes[start]&0xc3) || bytes[start+1] || bytes[start+2] || bytes[start+3]) invalid("WebP");
      const u24=i=>bytes[i]+(bytes[i+1]<<8)+(bytes[i+2]<<16);
      canvas={width:u24(start+4)+1,height:u24(start+7)+1};
    } else if(type==="VP8L") {
      if(image || size<=5 || bytes[start]!==0x2f) invalid("WebP");
      const bits=view.getUint32(start+1,true);
      if(bits>>>29) invalid("WebP");
      image={width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
    } else if(type==="VP8 ") {
      if(image || size<=10 || (bytes[start]&1) || text(bytes,start+3,start+6)!=="\x9d\x01\x2a") invalid("WebP");
      image={width:view.getUint16(start+6,true)&0x3fff,height:view.getUint16(start+8,true)&0x3fff};
    }
    pos=end+(size&1);
  }
  if(pos!==bytes.length || !image || (canvas && (canvas.width!==image.width || canvas.height!==image.height))) invalid("WebP");
  return image;
}
export function validateImageBytes(bytes,mime,{maxBytes=4*1024*1024,maxWidth=4096,maxHeight=4096,maxPixels=16*1024*1024}={}) {
  if(!(bytes instanceof Uint8Array) || !TYPES.has(mime)) invalid("MIME");
  if(bytes.length<32 || bytes.length>maxBytes) throw new RangeError("Image byte size outside approved limits");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const dimensions=mime==="image/png" ? pngDimensions(bytes,view) : mime==="image/jpeg" ? jpegDimensions(bytes,view) : webpDimensions(bytes,view);
  const {width,height}=dimensions;
  if(width<32 || height<32 || width>maxWidth || height>maxHeight || width*height>maxPixels)
    throw new RangeError("Image dimensions exceed permitted bounds");
  return Object.freeze({mime,width,height});
}
export function decodeImageDataUri(dataUri,limits={}) {
  const maxBytes=limits.maxBytes??4*1024*1024;
  if(typeof dataUri!=="string" || dataUri.length>Math.ceil(maxBytes/3)*4+32)
    throw new TypeError("Unsupported or oversized image data URI");
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  if(!match || match[0]!==dataUri) throw new TypeError("Base64 image data URI required");
  let binary;
  try { binary=atob(match[2]); } catch { throw new TypeError("Invalid base64 image"); }
  if(btoa(binary)!==match[2]) throw new TypeError("Canonical base64 image required");
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  return Object.freeze({...validateImageBytes(bytes,match[1],limits),bytes,dataUri});
}

// FUTURE / INACTIVE multimodal provider request builders.
// No network, database, payment or AI calls in this module.
// Cloudflare model interfaces verified against official Workers AI docs.
// Never accept external remote image URLs: only bounded browser-supplied data
// URIs and server-authorized action labels. No raw media logging.
export const VISION_MODEL="@cf/moondream/moondream3.1-9B-A2B";
export const IMAGE_MODEL="@cf/black-forest-labs/flux-2-klein-9b";
export const MEDIA_ACTION_FEATURE=Object.freeze({
  describe_image:"image_understanding",
  generate_image:"image_generation",
  create_wallpaper:"wallpaper_creation",
  edit_image:"image_editing",
  analyze_video_frames:"video_frame_analysis"
});
const MAX_IMAGE_BYTES=4*1024*1024;
const MAX_FRAMES=12;
const MAX_VIDEO_SECONDS=120;
const IMAGE_RE=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
function assertPrompt(text,max=2000){
  if(typeof text!=="string"||text.trim().length<3||text.length>max||
     /[\u0000-\u0008\u000e-\u001f]/.test(text))
    throw new TypeError("Valid bounded text prompt required");
  return text.trim();
}
function decodeImage(dataUri,{maxBytes=MAX_IMAGE_BYTES,maxWidth=4096,maxHeight=4096}={}){
  if(typeof dataUri!=="string")throw new TypeError("Base64 image data URI required");
  const m=IMAGE_RE.exec(dataUri);
  if(!m||m[2].length>Math.ceil(maxBytes*4/3)+8)
    throw new TypeError("Unsupported or oversized image data URI");
  let binary;
  try{binary=atob(m[2]);}catch{throw new TypeError("Invalid base64 image");}
  if(binary.length<24||binary.length>maxBytes)
    throw new RangeError("Image byte size outside approved limits");
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const be32=i=>((bytes[i]*0x1000000)+(bytes[i+1]<<16)+(bytes[i+2]<<8)+bytes[i+3])>>>0;
  let width=0,height=0;
  const mime=m[1];
  if(mime==="image/png"){
    if(![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n) ||
       String.fromCharCode(...bytes.slice(12,16))!=="IHDR")
      throw new TypeError("Invalid PNG file signature");
    width=be32(16);height=be32(20);
  } else if(mime==="image/jpeg"){
    if(bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||
       bytes[bytes.length-1]!==217)
      throw new TypeError("Invalid JPEG signature");
    let pos=2;
    while(pos+9<bytes.length){
      if(bytes[pos]!==255)throw new TypeError("Malformed JPEG marker");
      while(bytes[pos]===255)pos++;
      const marker=bytes[pos++];
      if(marker===0xd9||marker===0xda)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(pos+2>bytes.length)break;
      const length=bytes[pos]*256+bytes[pos+1];
      if(length<2||pos+length>bytes.length)throw new TypeError("Invalid JPEG segment");
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        if(length<7)throw new TypeError("Invalid JPEG dimensions");
        height=bytes[pos+3]*256+bytes[pos+4];
        width=bytes[pos+5]*256+bytes[pos+6];
        break;
      }
      pos+=length;
    }
  } else {
    if(String.fromCharCode(...bytes.slice(0,4))!=="RIFF"||
       String.fromCharCode(...bytes.slice(8,12))!=="WEBP")
      throw new TypeError("Invalid WebP signature");
    const fourcc=String.fromCharCode(...bytes.slice(12,16));
    if(fourcc==="VP8X"){
      width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);
      height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);
    } else if(fourcc==="VP8L"){
      if(bytes[20]!==0x2f)throw new TypeError("Invalid lossless WebP");
      const bits=(bytes[21]|(bytes[22]<<8)|(bytes[23]<<16)|(bytes[24]<<24))>>>0;
      width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;
    } else if(fourcc==="VP8 "){
      if(bytes[23]!==0x9d||bytes[24]!==0x01||bytes[25]!==0x2a)
        throw new TypeError("Invalid WebP dimensions");
      width=(bytes[26]|bytes[27]<<8)&0x3fff;
      height=(bytes[28]|bytes[29]<<8)&0x3fff;
    } else throw new TypeError("Unsupported WebP subtype");
  }
  if(!Number.isInteger(width)||!Number.isInteger(height)||
     width<32||height<32||width>maxWidth||height>maxHeight||
     width*height>16*1024*1024)
    throw new RangeError("Image dimensions exceed permitted bounds");
  return Object.freeze({mime,bytes,width,height,dataUri});
}
// Image-to-text; the user's untrusted visual content never becomes a system
// prompt. Output from the provider must be validated separately.
export function buildImageUnderstandingRequest({imageDataUri,question="Jelaskan isi gambar ini."}={}){
  const image=decodeImage(imageDataUri);
  const q=assertPrompt(question,1200);
  return Object.freeze({
    model:VISION_MODEL,
    payload:{
      task:"query",image:image.dataUri,question:q,
      reasoning:false,stream:false,max_tokens:512
    },
    width:image.width,height:image.height,
    requiredFeature:MEDIA_ACTION_FEATURE.describe_image
  });
}
// Image generation + reference editing, matching Workers AI binding's
// mandatory multipart wrapper. FLUX.2 Klein supports max 4 input images;
// each reference must be <=512x512 as documented by Cloudflare.
export function buildImageGenerationRequest({
  prompt,width=1024,height=1024,references=[],wallpaper=false
}={}){
  const text=assertPrompt(prompt,1800);
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<256||width>1920||height<256||height>1920||
    width*height>1920*1080)
    throw new RangeError("Image dimensions exceed image generator budget");
  if(!Array.isArray(references)||references.length>4)
    throw new TypeError("At most four bounded image references supported");
  const images=references.map(uri=>decodeImage(uri,{
    maxBytes:2*1024*1024,maxWidth:512,maxHeight:512
  }));
  const feature=images.length?"image_editing":
    wallpaper?"wallpaper_creation":"image_generation";
  const form=new FormData();
  form.append("prompt",text);
  form.append("width",String(width));form.append("height",String(height));
  images.forEach((img,index)=>form.append(
    "input_image_"+index,new Blob([img.bytes],{type:img.mime}),
    "reference-"+index+"."+img.mime.split("/")[1]
  ));
  const encoded=new Response(form);
  return Object.freeze({
    model:IMAGE_MODEL,
    payload:{
      multipart:{
        body:encoded.body,
        contentType:encoded.headers.get("content-type")
      }
    },
    requiredFeature:feature,width,height,referenceCount:images.length,
    // Output is a new generated file; it must not be confused with a raw
    // photograph or silently replace the original source asset.
    provenance:"AI-generated-or-edited; awaiting independent provider validation"
  });
}
export function buildVideoFrameAnalysisPlan({
  frames,durationSeconds,question="Ringkas video berdasarkan frame yang terlihat."
}={}){
  const q=assertPrompt(question,1200);
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0||
    durationSeconds>MAX_VIDEO_SECONDS)
    throw new RangeError("Video length outside short-video preview bounds");
  if(!Array.isArray(frames)||frames.length<1||frames.length>MAX_FRAMES)
    throw new RangeError("Video frame count outside preview bounds");
  let previous=-1;
  const prepared=frames.map(frame=>{
    if(!frame||!Number.isFinite(frame.atSeconds)||
       frame.atSeconds<=previous||frame.atSeconds<0||
       frame.atSeconds>durationSeconds)
      throw new TypeError("Frames must have strictly increasing timestamps");
    previous=frame.atSeconds;
    const result=buildImageUnderstandingRequest({
      imageDataUri:frame.imageDataUri,
      question:"Jelaskan frame video pada detik "+frame.atSeconds+
        ". Jangan mengarang gerak atau audio yang tidak terlihat. "+q
    });
    return Object.freeze({
      atSeconds:frame.atSeconds,model:result.model,payload:result.payload
    });
  });
  return Object.freeze({
    requiredFeature:MEDIA_ACTION_FEATURE.analyze_video_frames,
    frames:Object.freeze(prepared),
    durationSeconds,
    mode:"sampled_visual_frames_only",
    audioAnalyzed:false,motionContinuityVerified:false,
    requiresSeparateCreditReservationPerFrame:true
  });
}

import { decodeImageDataUri as decodeImage } from "../public/media-validation.js";
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
const MAX_VIDEO_IMAGE_BYTES=12*1024*1024;
const MAX_FRAMES=12;
const MAX_VIDEO_SECONDS=120;
function assertPrompt(text,max=2000){
  if(typeof text!=="string"||text.trim().length<3||text.length>max||
     /[\u0000-\u0008\u000e-\u001f]/.test(text))
    throw new TypeError("Valid bounded text prompt required");
  return text.trim();
}
// Image-to-text; the user's untrusted visual content never becomes a system
// prompt. Output from the provider must be validated separately.
export function buildImageUnderstandingRequest({imageDataUri,question="Jelaskan isi gambar ini."}={}){
  return imageUnderstandingRequest(decodeImage(imageDataUri),question);
}
function imageUnderstandingRequest(image,question){
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
    maxBytes:2*1024*1024,maxWidth:511,maxHeight:511
  }));
  // Tier must be bound to the *actual* operation at the server, never to a
  // browser-declared "Basic" operation. Large output and multi-reference
  // edits are Pro-only even when the prompt is labeled "wallpaper".
  const highDetail=width>1024||height>1024;
  const feature=images.length>1?"multi_reference_image_editing":
    highDetail?"high_detail_image_generation":
    images.length===1?"image_editing":
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
    referenceDimensions:Object.freeze(images.map(({width,height})=>Object.freeze({width,height}))),
    // Output is a new generated file; it must not be confused with a raw
    // photograph or silently replace the original source asset.
    provenance:"AI-generated-or-edited; awaiting independent provider validation"
  });
}
export function buildVideoFrameAnalysisPlan({
  frames,durationSeconds,question="Ringkas video berdasarkan frame yang terlihat."
}={}){
  // Leave room for the server's timestamp/instruction prefix in the vision
  // model's 1200-character question bound.
  const q=assertPrompt(question,1000);
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0||
    durationSeconds>MAX_VIDEO_SECONDS)
    throw new RangeError("Video length outside short-video preview bounds");
  if(!Array.isArray(frames)||frames.length<1||frames.length>MAX_FRAMES)
    throw new RangeError("Video frame count outside preview bounds");
  let previous=-1, totalBytes=0;
  const prepared=frames.map(frame=>{
    if(!frame||!Number.isFinite(frame.atSeconds)||
       frame.atSeconds<=previous||frame.atSeconds<0||
       frame.atSeconds>durationSeconds)
      throw new TypeError("Frames must have strictly increasing timestamps");
    previous=frame.atSeconds;
    const image=decodeImage(frame.imageDataUri);
    totalBytes+=image.bytes.byteLength;
    if(totalBytes>MAX_VIDEO_IMAGE_BYTES)
      throw new RangeError("Aggregate video image bytes exceed permitted bounds");
    const result=imageUnderstandingRequest(image,
      "Jelaskan frame video pada detik "+frame.atSeconds+
        ". Jangan mengarang gerak atau audio yang tidak terlihat. "+q
    );
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

// Optional invocation adapter for the INACTIVE multimodal coordinator.
// Constructing it performs no inference. Never use it from a public route
// without the coordinator's auth, budgets, moderation and trusted usage meter.
import {VISION_MODEL,IMAGE_MODEL,buildImageUnderstandingRequest} from "./multimodal-contract.js";
import {decodeImageDataUri} from "../public/media-validation.js";
const MAX_IMAGE_BYTES=8*1024*1024;
function cancelled(signal){if(signal?.aborted)throw new Error("Media request cancelled; upstream billing may be unknown");}
function normalizedImage(value){
  if(typeof value!=="string"||value.length>Math.ceil(MAX_IMAGE_BYTES/3)*4)
    throw new TypeError("Bounded provider image base64 required");
  let header;
  try{header=atob(value.slice(0,24));}catch{throw new TypeError("Invalid provider image base64");}
  const mime=header.startsWith("\x89PNG\r\n\x1a\n")?"image/png":
    header.startsWith("\xff\xd8")?"image/jpeg":
    header.startsWith("RIFF")&&header.slice(8,12)==="WEBP"?"image/webp":null;
  if(!mime)throw new TypeError("Unsupported provider image format");
  return decodeImageDataUri("data:"+mime+";base64,"+value,{maxBytes:MAX_IMAGE_BYTES}).dataUri;
}
export function createCloudflareMediaInvoker({AI}={}){
  if(typeof AI?.run!=="function")throw new TypeError("Workers AI binding required");
  return async function invoke({model,payload,signal}){
    cancelled(signal);
    let input;
    if(model===VISION_MODEL){
      if(!payload||payload.task!=="query"||payload.stream!==false||payload.reasoning!==false||
        !Number.isSafeInteger(payload.max_tokens)||payload.max_tokens<1||payload.max_tokens>512||
        Object.keys(payload).some(key=>!["task","image","question","reasoning","stream","max_tokens"].includes(key)))
        throw new TypeError("Bounded non-streaming vision request required");
      const rebuilt=buildImageUnderstandingRequest({imageDataUri:payload.image,question:payload.question});
      input={...rebuilt.payload,max_tokens:payload.max_tokens};
    }else if(model===IMAGE_MODEL){
      if(!payload||Object.keys(payload).some(key=>key!=="multipart")||
        !payload.multipart||Object.keys(payload.multipart).some(key=>!["body","contentType"].includes(key))||
        typeof payload.multipart.body?.getReader!=="function"||
        typeof payload.multipart.contentType!=="string"||
        !/^multipart\/form-data; boundary=[A-Za-z0-9_-]{1,100}$/.test(payload.multipart.contentType))
        throw new TypeError("Prepared provider multipart request required");
      input=payload;
    }else throw new TypeError("Unsupported media provider model");
    cancelled(signal);
    // No invented binding cancellation option and no automatic retries.
    // The coordinator's deadline holds funds when the upstream outcome is
    // uncertain. Account entitlement/real billing remain unverified here.
    const result=await AI.run(model,input);
    cancelled(signal);
    if(!result||typeof result!=="object"||Array.isArray(result))throw new TypeError("Structured media response required");
    if(model===VISION_MODEL){
      if(typeof result.answer!=="string"||!result.answer.trim()||result.answer.length>16000)
        throw new TypeError("Bounded provider vision answer required");
      return {answer:result.answer,providerUsage:{metrics:result.metrics}};
    }
    return {imageDataUri:normalizedImage(result.image),providerUsage:{metrics:result.metrics}};
  };
}

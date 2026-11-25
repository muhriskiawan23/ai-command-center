// Standalone test-only Worker. No DB, identity, production payments or credit grants.
export const catalog=Object.freeze({basic:Object.freeze({name:"BOR AI Basic",amount:"199",currency:"USD",interval:"month"}),pro:Object.freeze({name:"BOR AI Pro",amount:"699",currency:"USD",interval:"month"})});
const LIMIT=65536;
const enc=new TextEncoder();
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const flags={environment:"sandbox",productionCheckoutEnabled:false,realCreditsGranted:false,realSubscriptionEnabled:false};
export function checkoutConfig(env={}){
 const token=env.PADDLE_SANDBOX_CLIENT_TOKEN,basic=env.PADDLE_SANDBOX_BASIC_PRICE_ID,pro=env.PADDLE_SANDBOX_PRO_PRICE_ID;
 if(env.PADDLE_SANDBOX_ENABLED!=="true"||typeof token!=="string"||!/^test_[a-zA-Z0-9_]+$/.test(token)||typeof basic!=="string"||typeof pro!=="string"||!/^pri_[a-z0-9]+$/.test(basic)||!/^pri_[a-z0-9]+$/.test(pro)||basic===pro)return null;
 return {environment:"sandbox",token,prices:{basic,pro}};
}
export async function verifySignature(raw,header,secret,now=Math.floor(Date.now()/1000)){
 if(!(raw instanceof Uint8Array)||raw.length>LIMIT||typeof header!=="string"||header.length>2048||typeof secret!=="string"||secret.length<16)return false;
 const fields=header.split(";").map(s=>s.trim().split("="));
 const timestamps=fields.filter(p=>p[0]==="ts");
 const signatures=fields.filter(p=>p[0]==="h1").map(p=>p[1]);
 if(timestamps.length!==1||timestamps[0].length!==2||!/^\d{10}$/.test(timestamps[0][1])||!signatures.length||signatures.length>8||signatures.some(s=>!s||!/^[a-fA-F0-9]{64}$/.test(s)))return false;
 const ts=Number(timestamps[0][1]);
 if(!Number.isSafeInteger(ts)||Math.abs(now-ts)>5)return false;
 const prefix=enc.encode(timestamps[0][1]+":");
 const payload=new Uint8Array(prefix.length+raw.length);payload.set(prefix);payload.set(raw,prefix.length);
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 for(const signature of signatures){const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));if(await crypto.subtle.verify("HMAC",key,bytes,payload))return true;}
 return false;
}
async function boundedBody(request){
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader();let size=0;const parts=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();return null;}parts.push(value);}}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const p of parts){result.set(p,offset);offset+=p.byteLength;}return result;
}
const events=new Set(["transaction.completed","transaction.payment_failed","subscription.created","subscription.updated","subscription.canceled","subscription.paused","subscription.resumed","subscription.past_due","adjustment.created","adjustment.updated"]);
const checkoutHtml="<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>BOR AI Paddle Sandbox</title></head><body><main><h1>BOR AI — sandbox checkout</h1><p>Test only. Do not enter real payment details. No BOR AI account, subscription or credits will be changed.</p><p id=\"status\" role=\"status\">Sandbox configuration unavailable.</p><button id=\"basic\" disabled>Test Basic ($1.99/month)</button><button id=\"pro\" disabled>Test Pro ($6.99/month)</button></main><script src=\"/checkout.js\" defer></script></body></html>";
const checkoutJs="(async()=>{const status=document.getElementById(\"status\"),buttons=[\"basic\",\"pro\"];try{const r=await fetch(\"/checkout-config\",{cache:\"no-store\"});if(!r.ok)return;const c=await r.json();if(c.environment!==\"sandbox\"||!/^test_[a-zA-Z0-9_]+$/.test(c.token)||!buttons.every(k=>/^pri_[a-z0-9]+$/.test(c.prices[k])))return;const s=document.createElement(\"script\");s.src=\"https://cdn.paddle.com/paddle/v2/paddle.js\";await new Promise((resolve,reject)=>{s.onload=resolve;s.onerror=reject;document.head.append(s);});Paddle.Environment.set(\"sandbox\");Paddle.Initialize({token:c.token,eventCallback:(event)=>{if(event.name===\"checkout.completed\")status.textContent=\"Test checkout completed. No real access or credits have been granted.\";}});status.textContent=\"Sandbox ready. Test cards only.\";for(const k of buttons){const b=document.getElementById(k);b.disabled=false;b.addEventListener(\"click\",()=>{try{Paddle.Checkout.open({items:[{priceId:c.prices[k],quantity:1}]});}catch{status.textContent=\"Could not open test checkout.\";}});}}catch{status.textContent=\"Sandbox initialization failed.\";}})();";
const checkoutCsp="default-src 'none'; script-src 'self' https://cdn.paddle.com; connect-src 'self' https://*.paddle.com; frame-src https://*.paddle.com; style-src 'unsafe-inline'; img-src https://*.paddle.com data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export default {async fetch(request,env={}){
 const path=new URL(request.url).pathname;
 if(path==="/checkout"&&request.method==="GET")return new Response(checkoutHtml,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":checkoutCsp,"X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"}});
 if(path==="/checkout.js"&&request.method==="GET")return new Response(checkoutJs,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 if(path==="/health"&&request.method==="GET")return reply({...flags,checkoutConfigured:!!checkoutConfig(env),webhookConfigured:env.PADDLE_SANDBOX_ENABLED==="true"&&typeof env.PADDLE_SANDBOX_WEBHOOK_SECRET==="string"&&env.PADDLE_SANDBOX_WEBHOOK_SECRET.length>=16,mode:"validation_only"});
 if(path==="/catalog"&&request.method==="GET")return reply({...flags,catalog});
 if(path==="/checkout-config"&&request.method==="GET"){const config=checkoutConfig(env);return config?reply(config):reply({error:"sandbox_not_configured"},503);}
 if(path!=="/webhook")return reply({error:"not_found"},404);
 if(request.method!=="POST")return reply({error:"method_not_allowed"},405);
 if(env.PADDLE_SANDBOX_ENABLED!=="true"||typeof env.PADDLE_SANDBOX_WEBHOOK_SECRET!=="string"||env.PADDLE_SANDBOX_WEBHOOK_SECRET.length<16)return reply({error:"sandbox_not_configured"},503);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")||""))return reply({error:"unsupported_media_type"},415);
 try{
 const raw=await boundedBody(request);if(raw===null)return reply({error:"body_too_large"},413);
 if(!await verifySignature(raw,request.headers.get("Paddle-Signature"),env.PADDLE_SANDBOX_WEBHOOK_SECRET))return reply({error:"invalid_signature"},401);
 let event;try{event=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}catch{return reply({error:"invalid_json"},400);}
 if(!event||typeof event.event_type!=="string"||typeof event.event_id!=="string"||!/^evt_[a-z0-9]+$/.test(event.event_id)||!event.data||typeof event.data!=="object")return reply({error:"invalid_event"},400);
 // Intentionally no state mutation, PII storage, logging or credit provisioning. Replay is harmless.
 return reply({...flags,received:true,recognized:events.has(event.event_type),mode:"validation_only"});
 }catch{return reply({error:"validation_unavailable"},503);}
}};

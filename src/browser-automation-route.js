// Authenticated, feature-gated BOR AI -> isolated private Browser Run Worker.
import { json } from "./http.js";
import { consumeUsage, refundUsage, usageDay, enforceDailyLimits } from "./daily-limits.js";
import { suggestBrowserStep } from "./browser-action-planner.js";
import {browserAllowedHosts,canonicalBrowserPlan,browserPlanNeedsApproval,safeBrowserResult} from "./browser-automation-policy.js";

const encoder=new TextEncoder();
const JOB_LIMIT_MAX=50;
const APPROVAL_SECONDS=120;
function hex(bytes){return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");}
function safeLimit(value,defaultValue){
  const n=Number(value);
  return Number.isInteger(n)&&n>=1&&n<=JOB_LIMIT_MAX?n:defaultValue;
}
function encoded(value){return btoa(String.fromCharCode(...encoder.encode(JSON.stringify(value)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function decoded(value){
  const bytes=Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
async function keyFor(secret){
  if(typeof secret!=="string"||secret.length<32)return null;
  return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
async function planHash(plan){return hex(await crypto.subtle.digest("SHA-256",encoder.encode(JSON.stringify(plan))));}
export async function signBrowserApproval(userId,plan,secret,now=Date.now()){
  const key=await keyFor(secret);if(!key)return null;
  const payload={uid:userId,exp:Math.floor(now/1000)+APPROVAL_SECONDS,nonce:crypto.randomUUID(),digest:await planHash(plan)};
  const claim=encoded(payload);
  const sig=hex(await crypto.subtle.sign("HMAC",key,encoder.encode(claim)));
  return {approvalToken:claim+"."+sig,expiresAt:new Date(payload.exp*1000).toISOString()};
}
export async function verifyBrowserApproval(token,userId,plan,secret,now=Date.now()){
  if(typeof token!=="string"||token.length>2000||!/^[-_A-Za-z0-9]+\.[a-f0-9]{64}$/.test(token))return null;
  const key=await keyFor(secret);if(!key)return null;
  try{
    const [claim,signature]=token.split(".");
    const sig=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
    if(!await crypto.subtle.verify("HMAC",key,sig,encoder.encode(claim)))return null;
    const payload=decoded(claim);
    if(payload?.uid!==userId||!Number.isInteger(payload.exp)||payload.exp<Math.floor(now/1000)||
      payload.exp>Math.floor(now/1000)+APPROVAL_SECONDS||
      typeof payload.nonce!=="string"||!/^[0-9a-f-]{36}$/.test(payload.nonce)||
      payload.digest!==await planHash(plan))return null;
    return payload.nonce;
  }catch{return null;}
}
async function readSmallJson(request){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type")||""))return null;
  const length=Number(request.headers.get("Content-Length")||0);
  if(!Number.isFinite(length)||length>7500)return null;
  try{const raw=await request.text();return raw.length<=7500?JSON.parse(raw):null;}
  catch{return null;}
}
async function reserveBrowserJob(env,userId){
  if(!env.DB?.prepare)return false;
  const day=usageDay();
  const userLimit=safeLimit(env.BROWSER_AGENT_DAILY_USER_JOBS,2);
  const globalLimit=safeLimit(env.BROWSER_AGENT_DAILY_GLOBAL_JOBS,10);
  const subject="provider:browser-agent:user:"+userId;
  const cost=await consumeUsage(env,day,subject,1,userLimit);
  if(cost===null)return false;
  try{
    const all=await consumeUsage(env,day,"provider:browser-agent:global:jobs",1,globalLimit);
    if(all===null){
      await refundUsage(env,day,[{subject,units:1}]);return false;
    }
    return true;
  }catch{
    await refundUsage(env,day,[{subject,units:1}]);return false;
  }
}
export async function handleBrowserAutomationRoute(request,env,{getSession,sameOrigin}){
  const path=new URL(request.url).pathname;
  if(!["/api/browser/plan","/api/browser/execute","/api/browser/suggest"].includes(path))return null;
  if(request.method!=="POST")return json({error:"method_not_allowed"},405,{Allow:"POST"});
  if(!sameOrigin(request))return json({error:"invalid_origin"},403);
  if(env.BROWSER_AGENT_ENABLED!=="true"||!env.BROWSER_AGENT?.fetch||
    typeof env.BROWSER_AGENT_TOKEN!=="string"||env.BROWSER_AGENT_TOKEN.length<32||
    !env.DB?.prepare)return json({error:"Browser automation belum diaktifkan." ,code:"browser_not_ready"},503);
  let user;
  try{user=await getSession(request,env);}
  catch{return json({error:"Sesi akun tidak dapat diperiksa."},503);}
  if(!user?.id)return json({error:"Masuk dengan akun Google untuk menggunakan browser."},401);
  try{
    const limited=await env.CHAT_LIMITER?.limit({key:"browser-agent:"+user.id});
    if(limited?.success===false)return json({error:"Terlalu banyak permintaan browser."},429);
    if(!limited) return json({error:"Pembatasan browser tidak tersedia."},503);
  }catch{return json({error:"Pembatasan browser tidak tersedia."},503);}
  const body=await readSmallJson(request);
  if(path==="/api/browser/suggest"){
    if(!body||typeof body.instruction!=="string"||body.instruction.length>400)
      return json({error:"Instruksi browser tidak valid."},400);
    const charged=await enforceDailyLimits(env,request,user,1);
    if(!charged.ok)return charged.response;
    const outcome=await suggestBrowserStep(env,body.instruction,body.page,browserAllowedHosts(env.BROWSER_AGENT_ALLOWED_HOSTS));
    if(outcome.error)return json({error:"AI belum menemukan langkah browser yang aman.",code:outcome.error},422);
    return json(outcome);
  }
  const plan=canonicalBrowserPlan(body?.plan,browserAllowedHosts(env.BROWSER_AGENT_ALLOWED_HOSTS));
  if(!plan)return json({error:"URL atau langkah tidak aman/tidak diizinkan.",code:"browser_plan_invalid"},400);
  if(path==="/api/browser/plan"){
    const proof=browserPlanNeedsApproval(plan)
      ? await signBrowserApproval(user.id,plan,env.BROWSER_APPROVAL_SECRET):null;
    if(browserPlanNeedsApproval(plan)&&!proof)return json({error:"Persetujuan browser belum dikonfigurasi."},503);
    return json({plan,requiresConfirmation:browserPlanNeedsApproval(plan),...proof});
  }
  if(browserPlanNeedsApproval(plan)){
    const nonce=await verifyBrowserApproval(body?.approvalToken,user.id,plan,env.BROWSER_APPROVAL_SECRET);
    if(!nonce)return json({error:"Persetujuan tidak sah, sudah kedaluwarsa, atau rencana berubah.",code:"browser_approval_invalid"},403);
    try{
      const consumed=await consumeUsage(env,usageDay(),"browser:approval:"+nonce,1,1);
      if(consumed===null)return json({error:"Persetujuan ini sudah digunakan."},409);
    }catch{return json({error:"Status persetujuan tidak tersedia."},503);}
  }
  if(!await reserveBrowserJob(env,user.id))return json({error:"Batas penggunaan browser harian tercapai atau belum tersedia.",code:"browser_daily_limit"},429);
  try{
    const response=await env.BROWSER_AGENT.fetch("https://browser-agent.internal/execute",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+env.BROWSER_AGENT_TOKEN},
      body:JSON.stringify(plan)
    });
    if(!response.ok)return json({error:"Browser gagal membuka atau menjalankan langkah yang diminta.",code:"browser_executor_unavailable"},502);
    const result=safeBrowserResult(await response.json(),plan.host);
    if(!result)return json({error:"Hasil browser tidak valid.",code:"browser_invalid_output"},502);
    return json(result);
  }catch{return json({error:"Browser tidak tersedia saat ini.",code:"browser_executor_unavailable"},503);}
}

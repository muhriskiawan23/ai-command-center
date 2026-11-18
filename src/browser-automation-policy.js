// Shared, dependency-free policy for BOR AI's optional isolated Browser Run worker.
// Webpage content and user/model-suggested plans are DATA, never trusted instructions.
export const BROWSER_MAX_STEPS = 5;
export const BROWSER_TEXT_MAX = 9000;
const HIGH_RISK = /\b(?:submit|send|save|publish|delete|remove|transfer|buy|checkout|purchase|order|pay|confirm|register|login|log in|sign in|authorize|grant|install|subscribe|unsubscribe|post|share|upload|kirim|simpan|hapus|bayar|beli|pesan|konfirmasi|terbit|bagikan|masuk|daftar)\b/i;
const SENSITIVE = /\b(?:password|passcode|otp|2fa|cvv|credit.?card|api.?key|access.?token|private.?key|secret|kata sandi|kode verifikasi|kartu kredit|rekening|ktp|nik|paspor)\b/i;
const TYPES = new Set(["click","fill","select"]);
const ROLES = new Set(["button","link","textbox","combobox","checkbox"]);
const MATCH_BY = new Set(["role","label","placeholder"]);

export function browserAllowedHosts(value) {
  return String(value||"").split(",").map(x=>x.trim().toLowerCase()).filter(x=>/^[a-z0-9.-]{4,253}$/.test(x)&&x.includes(".")&&!x.includes("..")&&!x.startsWith(".")&&!x.endsWith(".")&&!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(x)&&!/(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(x)&&!/(?:^|\.)(?:nip|sslip)\.io$/.test(x)).slice(0,20);
}
export function browserPublicUrl(value, allowedHosts) {
  if(typeof value!=="string"||value.length>1500)return null;
  try {
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password|| (url.port&&url.port!=="443"))return null;
    const host=url.hostname.toLowerCase().replace(/\.$/,"");
    if(!/^[a-z0-9.-]{4,253}$/.test(host)||!host.includes(".")||host.includes("..")||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)||
      /(?:^|\.)(?:nip|sslip)\.io$/.test(host)||
      !Array.isArray(allowedHosts)||!allowedHosts.includes(host))return null;
    url.hash="";
    return {url:url.href,host};
  } catch{return null;}
}
export function validateBrowserSteps(input) {
  if(!Array.isArray(input)||input.length>BROWSER_MAX_STEPS)return null;
  const steps=[];
  for(const action of input){
    if(!action||typeof action!=="object"||Array.isArray(action)||
      !TYPES.has(action.type)||!action.target||typeof action.target!=="object")return null;
    const {by,role,name}=action.target;
    if(!MATCH_BY.has(by)||typeof name!=="string"||!name.trim()||name.length>100||
      /[\r\n\x00-\x1f]/.test(name)||HIGH_RISK.test(name)||SENSITIVE.test(name))return null;
    if(by==="role"&&!ROLES.has(role))return null;
    if(by!=="role"&&role!==undefined)return null;
    if(action.type==="fill"&&((by==="role"&&role!=="textbox")||
      typeof action.value!=="string"||action.value.length>240||/[\x00-\x08\x0b-\x1f]/.test(action.value)))return null;
    if(action.type==="select"&&((by==="role"&&role!=="combobox")||
      typeof action.value!=="string"||action.value.length>100||HIGH_RISK.test(action.value)))return null;
    if(action.type==="click"&&(action.value!==undefined||(by==="role"&&!["button","link","checkbox"].includes(role))))return null;
    const normalized={type:action.type,target:by==="role"?{by,role,name:name.trim()}:{by,name:name.trim()}};
    if(action.type!=="click")normalized.value=action.value;
    steps.push(normalized);
  }
  return steps;
}
export function canonicalBrowserPlan(raw, allowedHosts) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const locator=browserPublicUrl(raw.url,allowedHosts);
  if(!locator)return null;
  const steps=validateBrowserSteps(raw.steps??[]);
  if(!steps)return null;
  return {url:locator.url,host:locator.host,steps};
}
export function browserPlanNeedsApproval(plan) { return !!plan?.steps?.length; }
export function safeBrowserResult(raw,expectedHost){
  if(!raw||raw.ok!==true||raw.host!==expectedHost)return null;
  const current=browserPublicUrl(raw.url,[expectedHost]);
  if(!current)return null;
  return {
    ok:true,host:raw.host,url:current.url,
    title:String(raw.title||"").slice(0,220),
    text:String(raw.text||"").slice(0,BROWSER_TEXT_MAX),
    elements:Array.isArray(raw.elements)?raw.elements.slice(0,24).map(x=>({role:String(x.role||"").slice(0,25),by:["role","label","placeholder"].includes(x.by)?x.by:"role",name:String(x.name||"").slice(0,100)})):[],
    stepsExecuted:Number.isSafeInteger(raw.stepsExecuted)?Math.max(0,Math.min(raw.stepsExecuted,BROWSER_MAX_STEPS)):0,
    truncated:raw.truncated===true
  };
}

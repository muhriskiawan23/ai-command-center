// A PRIVATE Cloudflare Browser Run Worker, reached only through a service binding.
// It cannot log in to websites, store cookies, bypass CAPTCHAs, or publish forms.
import { launch } from "@cloudflare/playwright";
import {browserAllowedHosts,browserPublicUrl,canonicalBrowserPlan,BROWSER_TEXT_MAX} from "../../src/browser-automation-policy.js";

function reply(data,status=200){
  return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
async function tokenMatches(expected,received){
  if(typeof expected!=="string"||expected.length<32||
    typeof received!=="string"||received.length<32||received.length>512)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(expected)),crypto.subtle.digest("SHA-256",enc.encode(received))]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let diff=0;
  for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
function locatorFor(page,target){
  if(target.by==="role")return page.getByRole(target.role,{name:target.name,exact:true});
  if(target.by==="label")return page.getByLabel(target.name,{exact:true});
  return page.getByPlaceholder(target.name,{exact:true});
}
function trimText(value,max){return String(value||"").slice(0,max);}
async function snapshot(page, host){
  const current=browserPublicUrl(page.url(),[host]);
  if(!current)throw Error("navigation_outside_allowlist");
  const [title,body,elements]=await Promise.all([
    page.title(),
    page.locator("body").innerText({timeout:4000}),
    page.locator("button, a, input, textarea, select, [role='button']").evaluateAll(nodes=>
      nodes.slice(0,80).filter(el=>!["password","hidden","file"].includes(el.type?.toLowerCase())).map(el=>{
        const role=(el.getAttribute("role")||({
          BUTTON:"button",A:"link",INPUT:"textbox",TEXTAREA:"textbox",SELECT:"combobox"
        }[el.tagName]||"element")).slice(0,24);
        const accessible=el.getAttribute("aria-label")||el.labels?.[0]?.innerText||el.innerText||"";
        const placeholder=el.getAttribute("placeholder")||"";
        const name=(accessible||placeholder).trim().slice(0,100);
        const by=accessible?"role":(placeholder?"placeholder":"role");
        return {role,by,name};
      }).filter(item=>item.name&&["button","link","textbox","combobox","checkbox"].includes(item.role)).slice(0,24)
    )
  ]);
  return {host,url:current.url,title:trimText(title,220),text:trimText(body,BROWSER_TEXT_MAX),
    elements,truncated:body.length>BROWSER_TEXT_MAX};
}
export async function runBrowserJob(plan,env,{launchBrowser=launch}={}){
  const browserHosts=browserAllowedHosts(env.BROWSER_ALLOWED_HOSTS);
  const policyPlan=canonicalBrowserPlan(plan,browserHosts);
  if(!policyPlan)throw Error("invalid_or_unauthorized_plan");
  const assetHosts=browserAllowedHosts(env.BROWSER_ASSET_ALLOWED_HOSTS);
  const permitted=[...new Set([policyPlan.host,...assetHosts])].slice(0,20);
  if(!env.BROWSER||env.BROWSER_EXECUTION_ENABLED!=="true")throw Error("browser_disabled");
  // Enforce host restrictions in the Browser Run service itself, not only in JS.
  const browser=await launchBrowser(env.BROWSER,{guardrails:{allowedDomains:permitted},keep_alive:60000});
  let context;
  try{
    context=await browser.newContext({acceptDownloads:false,serviceWorkers:"block"});
    // Defense in depth: no off-allowlist subresources, POST/PUT, or hidden
    // credential-submitting requests. This agent is public-site/preview-only.
    await context.route("**/*",async route=>{
      const request=route.request();
      let url;
      try{url=new URL(request.url());}catch{return route.abort();}
      const ok=(request.method()==="GET"||request.method()==="HEAD")&&
        browserPublicUrl(url.href,permitted)!==null;
      if(!ok)return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
    page.on("popup",async popup=>{try{await popup.close()}catch{}});
    await page.goto(policyPlan.url,{waitUntil:"domcontentloaded",timeout:14000});
    let done=0;
    for(const step of policyPlan.steps){
      const locator=locatorFor(page,step.target);
      const count=await locator.count();
      if(count!==1)throw Error("locator_not_unique");
      if(step.type==="click")await locator.click({timeout:3500});
      else if(step.type==="fill")await locator.fill(step.value,{timeout:3500});
      else if(step.type==="select")await locator.selectOption({label:step.value},{timeout:3500});
      done++;
      const current=browserPublicUrl(page.url(),[policyPlan.host]);
      if(!current)throw Error("navigation_outside_allowlist");
    }
    const result=await snapshot(page,policyPlan.host);
    return {ok:true,...result,stepsExecuted:done};
  }finally{
    try{await context?.close()}catch{}
    try{await browser.close()}catch{}
  }
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path!=="/execute")return reply({error:"not_found"},404);
    if(request.method!=="POST")return reply({error:"method_not_allowed"},405);
    if(env.BROWSER_EXECUTION_ENABLED!=="true"||!env.BROWSER)return reply({error:"browser_disabled"},503);
    const bearer=request.headers.get("Authorization")||"";
    if(!await tokenMatches(env.INTERNAL_BROWSER_AGENT_TOKEN,bearer.startsWith("Bearer ")?bearer.slice(7):""))
      return reply({error:"unauthorized"},401);
    if(!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type")||""))return reply({error:"invalid_content_type"},415);
    const size=Number(request.headers.get("Content-Length")||0);
    if(!Number.isFinite(size)||size>8192)return reply({error:"payload_too_large"},413);
    let plan;
    try{
      const body=await request.text();
      if(body.length>8192)return reply({error:"payload_too_large"},413);
      plan=JSON.parse(body);
    }catch{return reply({error:"invalid_json"},400);}
    if(!canonicalBrowserPlan(plan,browserAllowedHosts(env.BROWSER_ALLOWED_HOSTS)))return reply({error:"invalid_or_unauthorized_plan"},400);
    try{return reply(await runBrowserJob(plan,env));}
    catch(error){
      const name=String(error?.message||"");
      // Never return DOM, cookie, headers, token, or raw provider error text.
      if(["invalid_or_unauthorized_plan","browser_disabled","navigation_outside_allowlist","locator_not_unique"].includes(name))
        return reply({error:name},400);
      return reply({error:"browser_execution_failed"},502);
    }
  }
};

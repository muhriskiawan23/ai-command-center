import test from "node:test";
import assert from "node:assert/strict";
import {
  browserAllowedHosts,browserPublicUrl,canonicalBrowserPlan,validateBrowserSteps,
  browserPlanNeedsApproval,safeBrowserResult,BROWSER_MAX_STEPS
} from "../src/browser-automation-policy.js";
import {signBrowserApproval,verifyBrowserApproval} from "../src/browser-automation-route.js";
const ALLOWED=["demo.playwright.dev","example.com"];
const safe={url:"https://demo.playwright.dev/todomvc/",steps:[]};
const click={url:safe.url,steps:[{type:"click",target:{by:"role",role:"button",name:"Clear completed"}}]};
test("browser host allowlist forbids private IPs, credentials, local networks, ports, cross-domain and HTTP",()=>{
 assert.deepEqual(browserAllowedHosts("demo.playwright.dev,example.com,127.0.0.1,localhost,private.internal"),["demo.playwright.dev","example.com"]);
 const accepted=browserPublicUrl("https://demo.playwright.dev/todomvc/#local",ALLOWED);
 assert.equal(accepted.url,"https://demo.playwright.dev/todomvc/");
 for(const input of [
  "http://example.com","https://user:pass@example.com","https://127.0.0.1",
  "https://192.168.0.1","https://localhost/","https://example.com:444/",
  "https://other.example.com","https://[::1]","file:///etc/passwd",
  "javascript:alert(1)","https://local.internal","https://127.0.0.1.nip.io",
  "https://example.com.evil.test/","https://169.254.169.254/latest/meta-data"
 ])assert.equal(browserPublicUrl(input,ALLOWED),null,input);
});
test("browser plans are short, accessible-target only, and refuse high-impact/site account operations",()=>{
 assert.equal(canonicalBrowserPlan(safe,ALLOWED).steps.length,0);
 const p=canonicalBrowserPlan(click,ALLOWED);
 assert.equal(browserPlanNeedsApproval(p),true);
 assert.deepEqual(p.steps,click.steps);
 for(const action of [
  {type:"click",target:{by:"role",role:"button",name:"Pay now"}},
  {type:"click",target:{by:"role",role:"button",name:"Hapus akun"}},
  {type:"click",target:{by:"role",role:"button",name:"Submit form"}},
  {type:"fill",target:{by:"placeholder",name:"Password"},value:"123"},
  {type:"fill",target:{by:"label",name:"User"},value:"x".repeat(241)},
  {type:"evaluate",source:"fetch('/secret')"},
  {type:"click",target:{by:"css",selector:"body"}},
  {type:"click",target:{by:"role",role:"heading",name:"Welcome"}},
  {type:"click",target:{by:"role",role:"button",name:"Open"},value:"test"},
 ])assert.equal(validateBrowserSteps([action]),null,JSON.stringify(action));
 assert.equal(validateBrowserSteps(Array(BROWSER_MAX_STEPS+1).fill(click.steps[0])),null);
 const fill=validateBrowserSteps([{type:"fill",target:{by:"placeholder",name:"Search"},value:"openai"}]);
 assert.equal(fill[0].value,"openai");
});
test("browser results only pass bounded public metadata",()=>{
 const response=safeBrowserResult({ok:true,host:"example.com",url:"https://example.com",title:"Hi",text:"x".repeat(12000),
  elements:[{role:"button",name:"Continue",by:"role"}],privateKeys:"do not output",stepsExecuted:500}, "example.com");
 assert.equal(response.text.length,9000);
 assert.equal(response.elements[0].name,"Continue");
 assert.equal(response.privateKeys,undefined);
 assert.equal(response.stepsExecuted,5);
 assert.equal(safeBrowserResult({...response,host:"evil.com"},"example.com"),null);
 assert.equal(safeBrowserResult({...response,url:"https://evil.com/private"},"example.com"),null);
});
test("browser HMAC approval is user-bound, plan-bound, expires and rejects tampering",async()=>{
 const secret="s".repeat(40), user="account-alpha";
 const plan=canonicalBrowserPlan(click,ALLOWED);
 const signed=await signBrowserApproval(user,plan,secret,1_800_000_000_000);
 assert.ok(signed.approvalToken.length>50);
 const nonce=await verifyBrowserApproval(signed.approvalToken,user,plan,secret,1_800_000_000_100);
 assert.match(nonce,/^[0-9a-f-]{36}$/);
 assert.equal(await verifyBrowserApproval(signed.approvalToken,"account-beta",plan,secret,1_800_000_000_100),null);
 assert.equal(await verifyBrowserApproval(signed.approvalToken,user,canonicalBrowserPlan(safe,ALLOWED),secret,1_800_000_000_100),null);
 assert.equal(await verifyBrowserApproval(signed.approvalToken,user,plan,secret,1_800_000_150_000),null);
 assert.equal(await verifyBrowserApproval(signed.approvalToken+"x",user,plan,secret,1_800_000_000_100),null);
 assert.equal(await signBrowserApproval(user,plan,"short"),null);
});

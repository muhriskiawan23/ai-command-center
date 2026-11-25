import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";
import {costRouteGuard,serverPdfConversionAllowed} from "../src/runtime-security-policy.js";
const paths=["/api/chat","/api/public/chat","/api/documents/pdf","/api/integrations/telegram/webhook"];
const url=p=>new URL("https://app.getborai.com"+p);
test("production cost ingress rejects missing DB or limiter before any provider call",async()=>{
 let calls=0; const AI={async run(){calls++;},async toMarkdown(){calls++;}};
 for(const p of paths)for(const env of [{AI},{AI,DB:{prepare(){assert.fail("no DB operation before rejection")}}},{AI,CHAT_LIMITER:{limit:async()=>({success:true})}}]){
  const res=await worker.fetch(new Request(url(p),{method:"POST"}),env);
  assert.equal(res.status,503);assert.equal((await res.json()).code,"quota_security_unavailable");
 }
 assert.equal(calls,0);
});
test("strict flag protects alternate Worker host and local harness stays usable",()=>{
 const u=new URL("https://preview.example/api/chat");
 assert.equal(costRouteGuard({},u,"POST"),null);
 assert.equal(costRouteGuard({BOR_RUNTIME_SECURITY_REQUIRED:"true"},u,"POST").code,"quota_security_unavailable");
 assert.equal(costRouteGuard({BOR_RUNTIME_SECURITY_REQUIRED:"true",DB:{prepare(){}},CHAT_LIMITER:{limit(){}}},u,"POST"),null);
 assert.equal(costRouteGuard({},url("/api/health"),"GET"),null);
});
test("server PDF conversion is explicitly unavailable in production or when text caps active; local path preserved",()=>{
 const AI={toMarkdown(){}},local=new URL("http://localhost/api/documents/pdf");
 assert.equal(serverPdfConversionAllowed({AI},local),true);
 assert.equal(serverPdfConversionAllowed({AI},url("/api/documents/pdf")),false);
 assert.equal(serverPdfConversionAllowed({AI,BOR_TEXT_AI_DAILY_USD_LIMIT:"0.10"},local),false);
 assert.equal(serverPdfConversionAllowed({AI,BOR_TEXT_BACKUP_ENABLED:"true"},local),false);
 assert.match(readFileSync("public/app.js","utf8"),/return extractPdfLocally\(file,/);
});
test("generic production deploy rejects schema mutation and contains no generic apply command",()=>{
 const w=readFileSync(".github/workflows/bor-ai-deploy.yml","utf8");
 const gate=w.indexOf("Generic production D1 writes are disabled");
 const credentials=w.indexOf("- name: Validate required credentials");
 assert.ok(gate>0&&credentials>gate);
 assert.doesNotMatch(w,/d1 migrations apply bor-ai-chat/);
 assert.match(w,/Generic migration path is retired; no schema write performed/);
 assert.equal(JSON.parse(readFileSync("wrangler.jsonc","utf8")).vars.BOR_RUNTIME_SECURITY_REQUIRED,"true");
});

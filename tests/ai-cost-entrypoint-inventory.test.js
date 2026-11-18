// Static, offline drift alert for BOR AI cost-bearing AI and tool paths.
// This is a launch review checklist, NOT proof of coverage or live paid metering.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=(path)=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
const main=source("index.js");
const widget=source("widget-api.js");
const telegram=source("telegram.js");
const research=source("research.js");
const extract=source("tavily-extract.js");

test("direct Workers AI calls in main Worker require paid-gate inventory review on change",()=>{
  // Includes deadline/locale/memory wrappers; these are callsites, not five
  // independent customer inferences. The main generate() call may retry.
  const runCalls=[...main.matchAll(/\benv\.AI\.run\s*\(/g)];
  const markdownCalls=[...main.matchAll(/\benv\.AI\.toMarkdown\s*\(/g)];
  assert.equal(runCalls.length,4,"AI.run callsites changed: review billing-gate wiring and all wrappers");
  assert.equal(markdownCalls.length,1,"PDF conversion route changed: review conversion-cost treatment");
  assert.match(main,/const generated = await env\.AI\.run\(selection\.model\.id,/);
  assert.match(main,/const converted = await env\.AI\.toMarkdown\(/);
});

test("web, public API, Telegram and PDF routes remain recorded as distinct entrypoints",()=>{
  for(const route of [
    'url.pathname === "/api/chat"',
    'url.pathname === "/api/public/chat"',
    'url.pathname === "/api/integrations/telegram/webhook"',
    'url.pathname === "/api/documents/pdf"'
  ]) assert.ok(main.includes(route),"Missing expected AI entrypoint: "+route);
  assert.match(main,/handlePublicChatRoute\(request, env,/);
  assert.match(main,/handleTelegramWebhook\(request, env,/);
  assert.match(main,/handlePdfConversionRoute\(request, env\)/);
  assert.match(widget,/await deps\.runAgent\(aiEnv,/);
  assert.match(telegram,/await deps\.runMultiAgent\(aiEnv,/);
  assert.match(telegram,/await deps\.runAgent\(aiEnv,/);
  assert.doesNotMatch(widget,/\benv\.AI\.(?:run|toMarkdown)\s*\(/);
  assert.doesNotMatch(telegram,/\benv\.AI\.(?:run|toMarkdown)\s*\(/);
});

test("research and Extract are separately identified cost-bearing tool paths",()=>{
  assert.match(main,/\bsearchExternal\(/);
  assert.match(main,/\bextractWithTavily\(/);
  assert.match(research,/export async function searchExternal\(/);
  assert.match(extract,/export async function extractWithTavily\(/);
  // The provider controls and per-operation billing must be audited
  // separately; passing this test must never enable a payment feature.
});

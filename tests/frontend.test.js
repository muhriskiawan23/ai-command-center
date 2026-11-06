import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
const html = page + "\n" + appJs + "\n" + appCss;

test("dashboard JavaScript parses without syntax errors", () => {
  assert.match(page, /<script src="\/app\.js"/);
  assert.doesNotThrow(() => new Function(appJs));
});

test("dashboard contains the controls used by its application script", () => {
  const requiredIds = [
    "sidebar", "newChat", "history", "clearHistory", "about",
    "menuBtn", "healthDot", "healthText", "conversation", "welcome",
    "messages", "workflow", "workflowItems", "chatForm", "prompt",
    "agent", "send", "toast"
  ];
  const ids = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const id of requiredIds) assert.ok(ids.has(id), "missing required element #" + id);
});

test("dashboard escapes model output before applying Markdown formatting", () => {
  assert.match(appJs, /function escapeHTML\(s\)/);
  assert.match(appJs, /function markdown\(input\)/);
  assert.match(appJs, /escapeHTML\(/);
});

test("assistant message actions offer copy and downloadable text/Markdown", () => {
  assert.match(appJs, /function copyText\(value\)/);
  assert.match(appJs, /function downloadText\(value, role/);
  assert.match(appJs, /function downloadMarkdown\(value, role/);
  assert.match(appJs, /text\/plain;charset=utf-8/);
  assert.match(appJs, /text\/markdown;charset=utf-8/);
  assert.match(appJs, /Salin/);
  assert.match(appJs, /Markdown/);
  assert.match(appJs, /Teks/);
  assert.match(appJs, /URL\.createObjectURL\(blob\)/);
});

test("dashboard has a mobile layout and reduced-motion support", () => {
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test("guest mode never persists browser chat history and account history is server-backed", () => {
  assert.doesNotMatch(html, /localStorage/);
  assert.match(html, /Guest Mode/);
  assert.match(html, /api\/conversations/);
  assert.match(html, /api\/auth\/google/);
  assert.match(html, /function deleteChat/);
  assert.match(html, /google\.accounts\.id\.initialize/);
});


test("About BOR AI opens an accessible, user-invoked dialog with a close control", () => {
  assert.match(page, /<dialog[^>]+id="aboutDialog"/);
  assert.match(page, /aria-labelledby="aboutTitle"/);
  assert.match(page, /id="aboutClose"/);
  assert.match(appJs, /aboutDialog\.showModal\(\)/);
  assert.match(appJs, /aboutDialog\.close\(\)/);
  assert.match(appJs, /event\.clientX<rect\.left/);
  assert.match(appCss, /\.about-dialog::backdrop/);
  assert.match(appCss, /@media\(max-width:560px\)/);
});

test("welcome screen keeps the four starter prompts and sidebar has no redundant template entry", () => {
  assert.match(page, /data-prompt="Bantu gw menyusun rencana kerja/);
  assert.match(page, /data-prompt="Analisis masalah ini secara kritis/);
  assert.match(page, /data-prompt="Bantu gw membuat ide konten/);
  assert.match(page, /data-prompt="Tinjau kode atau arsitektur aplikasi/);
  assert.doesNotMatch(page, /id="openTemplates"|id="templatesDialog"|Prompt templates/);
  assert.doesNotMatch(appJs, /PROMPT_TEMPLATES|renderPromptTemplates|openPromptTemplates/);
  assert.doesNotMatch(appCss, /templates-dialog|template-card/);
});

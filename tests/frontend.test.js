import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
const html = page + "\n" + appJs + "\n" + appCss;

test("dashboard inline JavaScript parses without syntax errors", () => {
  assert.match(page, /<script src="\/app\.js"/, "index.html must load /app.js");
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
  assert.match(html, /function escapeHTML\(s\)/);
  assert.match(html, /function markdown\(input\)/);
  assert.match(html, /src=escapeHTML\(src\)/);
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("dashboard inline JavaScript parses without syntax errors", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const inlineScripts = scripts.filter((match) => !/\bsrc\s*=/.test(match[0]));
  assert.ok(inlineScripts.length > 0, "expected an inline application script");
  for (const script of inlineScripts) {
    assert.doesNotThrow(() => new Function(script[1]));
  }
});

test("dashboard contains the controls used by its application script", () => {
  const requiredIds = [
    "sidebar", "newChat", "history", "clearHistory", "about",
    "menuBtn", "healthDot", "healthText", "conversation", "welcome",
    "messages", "workflow", "workflowItems", "chatForm", "prompt",
    "agent", "send", "toast"
  ];
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
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

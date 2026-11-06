import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/checklist.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const convert = context.window.BORChecklist.convertToChecklist;

test("converts unordered and numbered Markdown list items", () => {
  const result = convert("# Tasks\n- first\n* second\n+ third\n1. fourth\n2) fifth");
  assert.equal(result.ok, true);
  assert.equal(result.count, 5);
  assert.equal(result.markdown, "# Tasks\n- [ ] first\n- [ ] second\n- [ ] third\n- [ ] fourth\n- [ ] fifth");
});

test("preserves headings, paragraphs, indentation, and code fences in order", () => {
  const input = "# Plan\n\nIntro paragraph.\n\n  - nested task\n\n```md\n- not a task\n1. not a task either\n```\n\nConclusion.";
  const result = convert(input);
  assert.equal(result.count, 1);
  assert.equal(result.markdown, "# Plan\n\nIntro paragraph.\n\n  - [ ] nested task\n\n```md\n- not a task\n1. not a task either\n```\n\nConclusion.");
});

test("does not turn HTML-looking response text into markup", () => {
  const input = "<script>alert(1)</script>\n- safe task";
  const result = convert(input);
  assert.equal(result.markdown, "<script>alert(1)</script>\n- [ ] safe task");
});

test("normalizes CRLF and reports empty or non-list content without an empty checklist", () => {
  assert.deepEqual({ ...convert("Just a paragraph.\r\nNo list here.") }, {
    ok: false, count: 0, markdown: "Just a paragraph.\nNo list here."
  });
  assert.equal(convert("").ok, false);
});

test("dashboard loads the local converter before the application script", () => {
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(page.indexOf('/checklist.js') < page.indexOf('/app.js'));
});

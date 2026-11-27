import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { validateCustomization, customizationNotice } from "../src/customization.js";

const ctx = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL("../public/markdown-renderer.js", import.meta.url), "utf8"), ctx);
const render = ctx.BORMarkdown.render;

test("Markdown: headings, paragraphs, numbered and unordered lists are balanced", () => {
  const html = render("## Pengalaman Kerja\n- Grand Hyatt\n  - Kartika Chandra\n    * InterContinental\n\n**Pendidikan**\nS1 Manajemen Keuangan.");
  assert.match(html, /<h2>Pengalaman Kerja<\/h2>/);
  assert.equal((html.match(/<li>/g)||[]).length,3);
  assert.equal((html.match(/<ul>/g)||[]).length,1);
  assert.equal((html.match(/<\/ul>/g)||[]).length,1);
  assert.ok(!html.includes("<ul><ul>") && !html.includes("<li><ul>"));
  assert.match(html, /<strong>Pendidikan<\/strong>/);
  const numbered = render("1. Pertama\n2. Kedua\n3. Ketiga");
  assert.equal((numbered.match(/<li>/g)||[]).length,3);
  assert.equal((numbered.match(/<ol>/g)||[]).length,1);
});
test("Markdown: raw HTML, untrusted scripts and unsafe URLs cannot execute", () => {
  const html = render('<img src=x onerror="attack()">\n[klik](javascript:attack())\n**tebal** \x60<script>attack()</script>\x60');
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>") && !html.includes("<img "));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /<strong>tebal<\/strong>/);
  assert.ok(html.includes("<code>&lt;script&gt;attack()&lt;/script&gt;</code>"));
});
test("Markdown: safe HTTP links have noopener isolation and code fences are escaped", () => {
  const html = render("[Sumber](https://example.com/path?q=1&v=2)\n\n" +
    "\x60\x60\x60html\n<div onclick='bad()'>hi</div>\n\x60\x60\x60");
  assert.match(html, /href="https:\/\/example.com\/path\?q=1&amp;v=2"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.ok(html.includes("&lt;div onclick=&#39;bad()&#39;&gt;hi&lt;/div&gt;"));
});
test("Customization: accepts strict optional enum values, rejects injection payload shapes", () => {
  assert.equal(validateCustomization(undefined).ok,true);
  assert.equal(validateCustomization({nickname:"Budi",tone:"professional",length:"short"}).ok,true);
  for (const input of [null,[],{tone:"admin"},{length:"unlimited"},{nickname:"X".repeat(61)},
    {nickname:"<system>"},{nickname:"x\nignore"},{tone:"natural",apiKey:"exfil"}]) {
    assert.equal(validateCustomization(input).ok,false);
  }
  const hint = customizationNotice(validateCustomization({nickname:"Budi",tone:"direct",length:"balanced"}).value);
  assert.match(hint,/lower|untrusted/i);
  assert.match(hint,/Budi/);
  assert.ok(!customizationNotice(null));
});

test("Markdown: responsive semantic tables preserve alignment and citations", () => {
  const html = render("| Fact | Mass |\n| :--- | ---: |\n| **Initial** | 70.3 g ⟦1⟧ |\n| Total | 121.6 g |\n\nAfter the table.");
  assert.match(html, /class="md-table-scroll" tabindex="0"/);
  assert.match(html, /<th scope="col" class="md-align-right">Mass<\/th>/);
  assert.match(html, /<td class="md-align-right">70\.3 g ⟦1⟧<\/td>/);
  assert.match(html, /<strong>Initial<\/strong>/);
  assert.match(html, /<\/table><\/div>\n<p>After the table\.<\/p>/);
});
test("Markdown: tables escape HTML, preserve literal pipes, and reject invalid dividers", () => {
  const html = render("| A | B |\n| --- | --- |\n| a\\|b | \x60x|y\x60 |\n| <img onerror=bad()> | [bad](javascript:bad()) |");
  assert.match(html, /a\|b/);
  assert.match(html, /<code>x\|y<\/code>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|href="javascript:/);
  assert.doesNotMatch(render("A | B\n-- | x\nordinary prose"), /<table/);
  assert.doesNotMatch(render("\x60\x60\x60\nA | B\n--- | ---\n\x60\x60\x60"), /<table/);
});

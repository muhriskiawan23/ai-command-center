import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../marketing-site/", import.meta.url));
const read = path => readFileSync(root + path, "utf8");
const html = read("index.html");
const css = read("styles.css");

test("marketing site ships independently from the authenticated chat app", () => {
  for (const name of ["index.html", "styles.css", "logo-mark.svg", "_headers", "robots.txt", "sitemap.xml", "README.md"]) {
    assert.ok(existsSync(root + name), name);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /href="https:\/\/app\.getborai\.com\//);
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /href="\/logo-mark\.svg"/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /\/api\/auth|\/api\/chat|accounts\.google\.com/i);
});

test("unavailable paid plans cannot be mistaken for active checkout", () => {
  assert.match(html, /\$1\.99/);
  assert.match(html, /\$6\.99/);
  assert.match(html, /Basic and Pro are planned offers, not active subscriptions/);
  assert.match(html, /Paid subscriptions are not yet available/);
  assert.match(html, /No checkout or paid entitlement yet/g);
  assert.doesNotMatch(html, /href="[^"]*(checkout|payment|subscribe)[^"]*"/i);
});

test("standalone global marketing site includes accessibility and SEO essentials", () => {
  for (const id of ["features", "how-it-works", "pricing", "faq"]) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /name="description"/);
  assert.match(html, /rel="canonical" href="https:\/\/getborai\.com\/"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /focus-visible/);
  assert.match(read("_headers"), /Content-Security-Policy:/);
  assert.match(read("robots.txt"), /Sitemap: https:\/\/getborai\.com\/sitemap\.xml/);
});

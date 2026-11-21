import { test, expect } from "@playwright/test";
import { planBrowserTask, browserExecutionGate } from "../../src/browser-task-policy.js";

// Prove the browser interaction contract against an entirely offline HTML fixture.
// This is not a BOR AI production browser session or a Tavily provider test.
const documentFixture = [
  "<!doctype html><html lang='id'><head><title>Demo toko statis</title></head><body>",
  "<h1>Artikel publik</h1><p id='teaser'>Ringkasan pendek.</p>",
  "<button id='details' type='button'>Tampilkan rincian</button>",
  "<p id='full' hidden>Isi dinamis yang muncul setelah interaksi JavaScript.</p>",
  "<label>Catatan <input id='note' autocomplete='off'></label>",
  "<p id='preview'></p>",
  "<script>",
  "document.getElementById('details').addEventListener('click', () => {",
  "document.getElementById('full').hidden = false;",
  "});",
  "document.getElementById('note').addEventListener('input', event => {",
  "document.getElementById('preview').textContent = event.target.value;",
  "});",
  "</script></body></html>"
].join("");

test("offline browser can inspect JS-rendered text without a live web request", async ({ page }) => {
  const blocked = [];
  await page.route("**/*", route => {
    blocked.push(route.request().url());
    return route.abort();
  });
  const preview = planBrowserTask({
    url: "https://public.example.org/article",
    steps: [{ type: "read_text" }, { type: "inspect_links" }]
  });
  expect(preview.ok).toBe(true);
  expect(preview.plan.guardrails.allowedDomains).toEqual(["public.example.org"]);
  expect(preview.plan.executionEnabled).toBe(false);
  expect(browserExecutionGate({ BOR_BROWSER_AUTOMATION_ENABLED: "true" }, preview).code)
    .toBe("browser_runtime_not_connected");
  await page.setContent(documentFixture);
  await expect(page.locator("#full")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Artikel publik" })).toBeVisible();
  // This click happens only against an offline fixture inside Playwright tests.
  await page.locator("#details").click();
  await expect(page.locator("#full")).toHaveText("Isi dinamis yang muncul setelah interaksi JavaScript.");
  expect(blocked).toEqual([]);
});

test("form fill is redacted in previews and cannot be executed by live BOR AI flags", async ({ page }) => {
  const preview = planBrowserTask({
    url: "https://public.example.org/feedback",
    steps: [{ type: "fill", selector: "#note", value: "data pribadi milik pengguna" }]
  });
  expect(preview.ok).toBe(true);
  expect(preview.plan.approvalRequired).toBe(true);
  expect(JSON.stringify(preview)).not.toContain("data pribadi milik pengguna");
  expect(browserExecutionGate({ BOR_BROWSER_AUTOMATION_ENABLED: "true" }, preview).code)
    .toBe("action_requires_approval");
  await page.setContent(documentFixture);
  // Separate proof that Playwright itself can fill a field in an offline test.
  // This is not authorization to submit, send or modify a real third-party site.
  await page.locator("#note").fill("isi simulasi");
  await expect(page.locator("#preview")).toHaveText("isi simulasi");
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const asset = (filename) => readFileSync(new URL("../../marketing-site/" + filename, import.meta.url), "utf8");

test.beforeEach(async ({ page }) => {
  // Every getborai.com response is intercepted locally: no Cloudflare, external API,
  // user data, identity cookies, or chargeable provider calls.
  await page.route("https://getborai.com/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const staticFiles = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/index.html": ["index.html", "text/html; charset=utf-8"],
      "/styles.css": ["styles.css", "text/css; charset=utf-8"],
      "/logo-mark.svg": ["logo-mark.svg", "image/svg+xml"],
      "/robots.txt": ["robots.txt", "text/plain; charset=utf-8"],
      "/sitemap.xml": ["sitemap.xml", "application/xml"]
    };
    const selected = staticFiles[pathname];
    await route.fulfill({
      status: selected ? 200 : 404,
      contentType: selected?.[1] || "text/html; charset=utf-8",
      body: asset(selected?.[0] || "404.html")
    });
  });
});

test("marketing home explains BOR AI without exposing private chat or paid checkout", async ({ page }) => {
  const response = await page.goto("https://getborai.com/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /Big ideas start with one question/i })).toBeVisible();

  const cta = page.getByRole("link", { name: /Try BOR AI free/i });
  await expect(cta).toHaveAttribute("href", "https://app.getborai.com/");
  await expect(cta).toBeVisible();
  await expect(page.locator("#features")).toHaveCount(1);
  await expect(page.locator("#pricing")).toContainText("Planned · Not for sale");
  await expect(page.locator("#pricing")).toContainText("$1.99");
  await expect(page.locator("#pricing")).toContainText("$6.99");

  // No unexpected horizontal scrolling in the responsive layouts.
  const fitsViewport = await page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ));
  expect(fitsViewport).toBe(true);
});

test("unknown marketing routes return an actual non-indexable 404", async ({ page }) => {
  const response = await page.goto("https://getborai.com/nonexistent-marketing-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /Looks like this page wandered off/i })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("link", { name: /Open BOR AI/i })).toHaveAttribute("href", "https://app.getborai.com/");
});

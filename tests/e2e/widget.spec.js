import { test, expect } from "./fixtures.js";

test("embeddable widget opens, sends a message, and renders the answer as text", async ({ page, app }) => {
  await page.goto(app.url);
  await page.route("**/api/public/chat", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      response: "Jawaban BOR AI <img src=x onerror=alert(1)>",
      usage: { remaining: 98, limit: 100 }
    })
  }));
  await page.addScriptTag({
    url: app.url + "/widget.js",
    attributes: {
      "data-api-key": "borai_live_test_key_abcdefghijklmnopqrstuvwxyz123456",
      "data-api-url": app.url + "/api/public/chat"
    }
  });

  const widget = page.locator(".bor-ai-widget");
  const launcher = widget.getByRole("button", { name: "Chat dengan BOR AI" });
  await expect(launcher).toBeVisible();
  await launcher.click();
  const input = widget.getByRole("textbox", { name: "Pesan" });
  await input.fill("Halo dari website");
  await widget.getByRole("button", { name: "Kirim" }).click();

  await expect(widget.getByText("Halo dari website")).toBeVisible();
  await expect(widget.getByText("Jawaban BOR AI <img src=x onerror=alert(1)>")).toBeVisible();
  await expect(widget.locator("img")).toHaveCount(0);
  await expect(widget.getByRole("status")).toContainText("98 dari 100");
});

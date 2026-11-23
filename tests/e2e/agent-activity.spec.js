import { test, expect } from "@playwright/test";
import { startHarness } from "./harness.js";

// The existing harness runs the real Worker + the real public/ frontend locally,
// with a deterministic stub AI and temporary SQLite. No paid APIs or production data.
let app;
test.beforeEach(async ({ page }) => {
  app = await startHarness({ aiDelayMs: 1400 });
  await page.route("https://accounts.google.com/gsi/client", route =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.goto(app.url + "/?plan=free");
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#agentActivityTrigger")).toBeVisible();
});
test.afterEach(async () => { if (app) await app.close(); app = null; });

test("Living B opens a readable modal in every viewport and starts with animation OFF", async ({ page }) => {
  const trigger = page.locator("#agentActivityTrigger");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const panel = page.locator("#agentActivityPanel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-modal", "true");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#agentActivityMotion")).not.toBeChecked();
  await expect(page.locator("#agentActivityStop")).toBeDisabled();
  const rect = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(rect).toBeTruthy();
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Agent Activity tracks a real guest chat from pending to completed", async ({ page }) => {
  await page.locator("#prompt").fill("Tolong buat satu ide promosi BOR AI global.");
  await page.locator("#send").click();
  const status = page.locator("#agentActivityStatus");
  await expect(status).toHaveAttribute("data-phase", "running", { timeout: 12000 });
  await page.locator("#agentActivityTrigger").click();
  await expect(page.locator("#agentActivityTask")).toContainText("promosi BOR AI global");
  await expect(page.locator("#agentActivityStop")).toBeEnabled();
  await expect(status).toHaveAttribute("data-phase", "completed", { timeout: 28000 });
  await expect(page.locator("#messages .message.assistant")).not.toHaveCount(0);
  await expect(page.locator("#agentActivityStop")).toBeDisabled();
});

test("Stop delegates to chat cancellation and does not claim guaranteed server cancellation", async ({ page }) => {
  app.control.aiHang = true;
  await page.locator("#prompt").fill("Tolong kerjakan riset.");
  await page.locator("#send").click();
  await expect(page.locator("#agentActivityStatus")).toHaveAttribute("data-phase", "running", { timeout: 12000 });
  await page.locator("#agentActivityTrigger").click();
  await page.locator("#agentActivityStop").click();
  await expect(page.locator("#agentActivityStatus")).toHaveAttribute("data-phase", "cancelled", { timeout: 12000 });
  await expect(page.locator("#agentActivityDetails")).toContainText("tidak menjamin");
  await expect(page.locator("#agentActivityStop")).toBeDisabled();
  app.control.aiHang = false;
});

test("A session change clears the last task and rejects stale request events", async ({ page }) => {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("bor:agent-activity", {
      detail: { phase: "started", requestId: "old-request", agent: "analyst", task: "Sensitive private task" }
    }));
  });
  await page.locator("#agentActivityTrigger").click();
  await expect(page.locator("#agentActivityTask")).toContainText("Sensitive private task");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("bor:session-state", { detail: { state: "unauthenticated" } }));
    window.dispatchEvent(new CustomEvent("bor:agent-activity", {
      detail: { phase: "completed", requestId: "old-request" }
    }));
  });
  await expect(page.locator("#agentActivityPanel")).toBeHidden();
  await page.locator("#agentActivityTrigger").click();
  await expect(page.locator("#agentActivityTask")).not.toContainText("Sensitive private task");
  await expect(page.locator("#agentActivityStatus")).toHaveAttribute("data-phase", "idle");
});

test("Modal keyboard focus cycles within controls", async ({ page }) => {
  await page.locator("#agentActivityTrigger").click();
  await expect(page.locator("#agentActivityClose")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#agentActivityMotion")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#agentActivityClose")).toBeFocused();
});

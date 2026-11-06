import { test, expect } from "./fixtures.js";

test("assistant answer can be converted to a checklist and copied or downloaded", async ({ page, app }) => {
  app.control.aiText = "# Action plan\n\n- Review the report\n1. Confirm the figures\n\nKeep this paragraph.\n\n```md\n- This is code, not a task\n```";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#prompt").fill("Buat rencana kerja.");
  await page.locator("#send").click();
  const answer = page.locator(".message.assistant:not(#typing) .message-text").last();
  await expect(answer).toContainText("Review the report");
  const action = page.locator(".message.assistant:not(#typing) .checklist-action").last();
  await action.click();
  const preview = page.locator(".checklist-preview");
  await expect(preview).toContainText("- [ ] Review the report");
  await expect(preview).toContainText("- [ ] Confirm the figures");
  await expect(preview).toContainText("Keep this paragraph.");
  await expect(preview).toContainText("- This is code, not a task");
  await expect(page.locator(".checklist-export-actions")).toContainText("Salin checklist");
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".checklist-export-actions").getByRole("button", { name: "Unduh .md" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("bor-ai-checklist.md");
});

test("checklist action explains when an answer has no list items", async ({ page, app }) => {
  app.control.aiText = "This answer is a plain paragraph with no list.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill("Jelaskan singkat.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await page.locator(".message.assistant:not(#typing) .checklist-action").click();
  await expect(page.locator("#toast")).toContainText("Tidak ditemukan item daftar");
  await expect(page.locator(".checklist-preview")).toHaveCount(0);
});

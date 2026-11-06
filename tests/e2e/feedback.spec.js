import { test, expect, loginAs } from "./fixtures.js";

const ALICE = { id: "google-sub-feedback-alice", email: "feedback@example.com", name: "Feedback User" };

test("akun dapat menilai jawaban dan feedback tetap tampil setelah percakapan dimuat ulang", async ({ page, app, context }) => {
  await loginAs(context, app, ALICE);
  await page.goto(app.url);
  await expect(page.locator("#prompt")).toBeVisible();
  await page.locator("#prompt").fill("Jelaskan tujuan feedback dalam satu paragraf.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);

  const feedback = page.locator(".answer-feedback");
  await expect(feedback).toBeVisible();
  await feedback.getByRole("button", { name: "Jawaban tidak membantu" }).click();
  await feedback.getByRole("textbox", { name: "Alasan feedback opsional" }).fill("Jawaban perlu lebih spesifik.");
  await feedback.getByRole("button", { name: "Kirim feedback" }).click();
  await expect(feedback.locator(".feedback-status")).toHaveText("Feedback tersimpan");
  expect(app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n).toBe(1);

  await page.reload();
  await expect(page.locator(".answer-feedback")).toBeVisible();
  await expect(page.locator(".feedback-vote[aria-label='Jawaban tidak membantu']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".feedback-panel textarea")).toHaveValue("Jawaban perlu lebih spesifik.");
});

import { test, expect, loginAs } from "./fixtures.js";
const ALICE = { id: "feedback-e2e-alice", email: "feedback-e2e@example.com", name: "Feedback Tester" };
test("akun dapat mengirim feedback jawaban dan melihatnya kembali setelah reload", async ({ page, app, context }) => {
  await loginAs(context, app, ALICE);
  // The test asserts Indonesian accessible labels; do not depend on the CI browser locale.
  await page.addInitScript(() => localStorage.setItem("borai-language-preference", "id"));
  await page.goto(app.url);
  await expect(page.locator("#prompt")).toBeVisible();
  await page.locator("#prompt").fill("Jelaskan manfaat validasi data.");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  const feedback = page.locator(".message.assistant .answer-feedback");
  await expect(feedback).toBeVisible();
  await feedback.getByRole("button", { name: "Jawaban tidak membantu" }).click();
  await feedback.getByLabel("Alasan feedback opsional").fill("Penjelasan masih kurang lengkap.");
  await feedback.locator(".feedback-submit").click();
  await expect(feedback.locator(".feedback-status")).toHaveText("Feedback tersimpan");
  expect({ ...app.db.sqlite.prepare("SELECT rating, reason FROM answer_feedback").get() }).toEqual({ rating: "not_helpful", reason: "Penjelasan masih kurang lengkap." });
  await page.reload();
  await expect(page.locator(".message.assistant .answer-feedback")).toBeVisible();
  await expect(page.locator(".feedback-vote[aria-pressed='true']")).toHaveAttribute("aria-label", "Jawaban tidak membantu");
  await expect(page.locator(".feedback-status")).toHaveText("Feedback tersimpan");
});

test("ringkasan kemampuan muncul di chat dan tersimpan di riwayat akun", async ({ page, app, context }) => {
  await loginAs(context, app, ALICE);
  await page.addInitScript(() => localStorage.setItem("borai-language-preference", "id"));
  await page.goto(app.url);
  const prompt = page.locator("#prompt");
  await expect(prompt).toBeEditable();
  await prompt.fill("Apa kekuranganmu?");
  await page.locator("#send").click();
  const answer = page.locator(".message.assistant:not(#typing)");
  await expect(answer).toContainText("Pencarian sumber publik belum tersedia di sesi ini");
  await expect(answer).toContainText("Gunakan tombol + untuk mengunggah PDF");
  await expect(answer.getByRole("button", { name: "Jawaban tidak membantu" })).toBeVisible();
  expect(app.aiCalls).toHaveLength(0);
  await page.reload();
  await expect(answer).toContainText("Pencarian sumber publik belum tersedia di sesi ini");
});

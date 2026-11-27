import { test, expect, loginAs, seedConversation, drawerMode } from "./fixtures.js";

test.use({ harnessOptions: {
  googleClientId: "",
  extraEnv: { BOR_ACCOUNT_RECOVERY_ENABLED: "true" }
} });

test("recover an existing conversation without Google and reject a reused code", async ({ page, context, app }) => {
  const user = { id: "recovery-owner", email: "recovery@example.test", name: "Pemilik Uji" };
  await loginAs(context, app, user);
  seedConversation(app.db, { id: "recovery-chat", userId: user.id, title: "Percakapan pemulihan", updatedAt: 10 });
  await page.goto(app.url);
  if (drawerMode(page)) await page.locator("#menuBtn").click();
  await page.locator("#userProfile").click();
  await page.locator("#openRecoveryCode").click();
  await page.locator("#issueRecoveryCode").click();
  const field = page.locator("#issuedRecoveryCode");
  await expect(field).toHaveValue(/^BOR-/);
  const code = await field.inputValue();
  await page.locator("#accountBack").click();
  await expect(field).toHaveValue("");
  await page.locator("#signOut").click();
  const login = page.locator("#recoveryLogin");
  await login.locator("summary").click();
  await page.locator("#recoveryLoginCode").fill(code);
  await page.locator("#redeemRecoveryCode").click();
  await expect(page.locator("#userProfile")).toBeAttached();
  await expect(page.locator("#app")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  if (drawerMode(page)) await page.locator("#menuBtn").click();
  await expect(page.locator("#history")).toContainText("Percakapan pemulihan");
  await page.locator("#userProfile").click();
  await page.locator("#signOut").click();
  await login.locator("summary").click();
  await page.locator("#recoveryLoginCode").fill(code);
  await page.locator("#redeemRecoveryCode").click();
  await expect(page.locator("#recoveryLoginStatus")).toContainText("sudah dipakai");
  expect(app.aiCalls).toHaveLength(0);
});

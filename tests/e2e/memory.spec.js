import { test, expect, loginAs, drawerMode } from "./fixtures.js";

const ALICE = { id: "google-sub-alice", email: "alice@example.com", name: "Alice" };

async function openMemoryPanel(page) {
  if (drawerMode(page)) { await page.locator("#menuBtn").click(); await expect(page.locator("#sidebar")).toBeVisible(); }
  await page.locator("#openMemory").click();
  await expect(page.locator("#memoryPanel")).toBeVisible();
}

test.describe("MEMORI — opsional, hanya akun login", () => {
  test("tamu: tombol Memori hanya memberi petunjuk masuk dengan Google, tanpa membuka panel", async ({ page, app }) => {
    await page.goto(app.url);
    await page.locator("#continueGuest").click();
    if (drawerMode(page)) { await page.locator("#menuBtn").click(); await expect(page.locator("#sidebar")).toBeVisible(); }
    await page.locator("#openMemory").click();
    await expect(page.locator("#toast")).toContainText("Masuk dengan Google");
    await expect(page.locator("#memoryPanel")).toBeHidden();
  });

  test("akun: default mati; aktifkan, tambah, tolak data sensitif, hapus satu, hapus semua; status tersimpan di server", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await openMemoryPanel(page);
    await expect(page.locator("#memoryToggle")).not.toBeChecked();
    await expect(page.locator("#memoryEmpty")).toBeVisible();

    await page.locator("#memoryToggle").check();
    await expect.poll(() => app.db.sqlite.prepare("SELECT memory_enabled m FROM user_settings WHERE user_id = ?").get(ALICE.id)?.m).toBe(1);

    await page.locator("#memoryInput").fill("Panggil aku Budi dan jawab singkat");
    await page.locator("#memoryAdd").click();
    await expect(page.locator(".memory-item")).toHaveCount(1);
    await expect(page.locator(".memory-item")).toContainText("Panggil aku Budi");
    await expect(page.locator("#memoryCount")).toHaveText("1 / 30");

    await page.locator("#memoryInput").fill("password wifi saya abc123");
    await page.locator("#memoryInput").press("Enter");
    await expect(page.locator("#memoryError")).toContainText("data sensitif");
    await expect(page.locator(".memory-item")).toHaveCount(1);                        // tidak ikut tersimpan

    await page.locator("#memoryInput").fill("Aku suka kopi tanpa gula");
    await page.locator("#memoryAdd").click();
    await expect(page.locator(".memory-item")).toHaveCount(2);
    await page.locator(".memory-item", { hasText: "Panggil aku Budi" }).locator(".memory-del").click();
    await expect(page.locator(".memory-item")).toHaveCount(1);
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM user_memories").get().n).toBe(1);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#memoryClearAll").click();
    await expect(page.locator(".memory-item")).toHaveCount(0);
    await expect(page.locator("#memoryEmpty")).toBeVisible();
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM user_memories").get().n).toBe(0);
  });

  test("isi memori tampil sebagai teks (tidak mengeksekusi HTML)", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await openMemoryPanel(page);
    await page.locator("#memoryInput").fill('Panggil aku <img src=x onerror="window.__xss=1">');
    await page.locator("#memoryAdd").click();
    await expect(page.locator(".memory-item")).toHaveCount(1);
    await expect(page.locator(".memory-item")).toContainText("<img src=x");
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator(".memory-item img").count()).toBe(0);
  });

  test("memori yang aktif dipakai di chat; setelah dimatikan tidak dipakai lagi", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await openMemoryPanel(page);
    await page.locator("#memoryToggle").check();
    await page.locator("#memoryInput").fill("Panggil aku Budi");
    await page.locator("#memoryAdd").click();
    await expect(page.locator(".memory-item")).toHaveCount(1);
    await page.locator("#memoryClose").click();
    await expect(page.locator("#memoryPanel")).toBeHidden();
    if (drawerMode(page)) { await page.locator("#drawerClose").click(); await expect(page.locator("#sidebar")).toBeHidden(); }
    await page.locator("#prompt").fill("Halo, siapa namaku?");
    await page.locator("#send").click();
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    expect(app.aiCalls.at(-1).messages.find((m) => m.role === "system").content).toContain("- Panggil aku Budi");
    await openMemoryPanel(page);
    await page.locator("#memoryToggle").uncheck();
    await expect.poll(() => app.db.sqlite.prepare("SELECT memory_enabled m FROM user_settings WHERE user_id = ?").get(ALICE.id).m).toBe(0);
    await page.locator("#memoryClose").click();
    if (drawerMode(page)) { await page.locator("#drawerClose").click(); await expect(page.locator("#sidebar")).toBeHidden(); }
    await page.locator("#prompt").fill("Halo lagi");
    await page.locator("#send").click();
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(2);
    expect(app.aiCalls.at(-1).messages.find((m) => m.role === "system").content).not.toContain("USER MEMORY");
  });

  test("Back menutup panel Memori lebih dulu (drawer tetap terbuka), lalu drawer; Escape juga menutup panel", async ({ page, app, context }) => {
    test.skip(!drawerMode(page), "hanya mode drawer");
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await openMemoryPanel(page);
    await page.goBack();
    await expect(page.locator("#memoryPanel")).toBeHidden();
    await expect(page.locator("#sidebar")).toBeVisible();                             // drawer masih terbuka
    await page.goBack();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#app")).toBeVisible();
    await openMemoryPanel(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#memoryPanel")).toBeHidden();
    await expect(page.locator("#sidebar")).toBeVisible();
  });

  test("Back/Escape di desktop menutup panel tanpa keluar aplikasi", async ({ page, app, context }) => {
    test.skip(drawerMode(page), "hanya desktop");
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await openMemoryPanel(page);
    await page.goBack();
    await expect(page.locator("#memoryPanel")).toBeHidden();
    expect(page.url().startsWith(app.url)).toBe(true);
    await openMemoryPanel(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#memoryPanel")).toBeHidden();
  });

  test("panel tidak menyebabkan overflow horizontal dan tombol tutup/aksi terjangkau di layar kecil", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await openMemoryPanel(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const vp = page.viewportSize();
    for (const id of ["#memoryClose", "#memoryToggle", "#memoryInput", "#memoryAdd"]) {
      const box = await page.locator(id).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    }
  });
});

import { test, expect, loginAs, seedSession, seedConversation, drawerMode } from "./fixtures.js";

const ALICE = { id: "google-sub-alice", email: "alice@example.com", name: "Alice" };
const BOB = { id: "google-sub-bob", email: "bob@example.com", name: "Bob" };

async function enterGuest(page, app) {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
}
async function send(page, text) {
  await page.locator("#prompt").fill(text);
  await page.locator("#prompt").press("Enter");
}
const noHorizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("AUTH — Welcome, Guest, session", () => {
  test("pengunjung baru melihat Welcome, bukan chat, dan tidak ada flash UI chat", async ({ page, app }) => {
    await page.goto(app.url);
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.getByRole("heading", { name: /BOR AI/ })).toBeVisible();
    await expect(page.locator("#continueGuest")).toBeVisible();
    await expect(page.locator("#googleButtonGate .gsi-stub")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    await expect(page.locator("#prompt")).toBeHidden();
    expect(await page.evaluate(() => window.__seen.appVisible)).toBe(false);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("Continue as Guest membuka chat yang berfungsi, dan refresh tidak memulihkan isi chat", async ({ page, app }) => {
    await enterGuest(page, app);
    await expect(page.locator("#authTitle")).toHaveText("Guest Mode");
    await send(page, "Halo dunia");
    await expect(page.locator(".message.assistant .message-body").first()).toContainText("Balasan uji");
    await page.reload();
    await expect(page.locator("#app")).toBeVisible();          // pilihan Guest diingat selama tab
    await expect(page.locator(".message")).toHaveCount(0);      // isi chat guest tidak disimpan
    await expect(page.locator("#welcome")).toBeVisible();
  });

  test("guest tidak pernah menulis isi chat ke storage", async ({ page, app }) => {
    await enterGuest(page, app);
    await send(page, "rahasia-guest-123");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const dump = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    expect(dump).not.toContain("rahasia-guest-123");
    expect(JSON.parse(dump).l).toEqual({});
  });

  test("user Google yang kembali langsung masuk tanpa flash 'Guest Mode' atau Welcome", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.route("**/api/auth/me", async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.continue(); });
    await page.goto(app.url);
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("#authTitle")).toHaveText("Masuk sebagai");
    await expect(page.locator("#gate")).toBeHidden();
    const seen = await page.evaluate(() => window.__seen);
    expect(seen.authTitles).toEqual(["Masuk sebagai"]);
  });

  test("sesi yang sudah kedaluwarsa dikenali dan pengguna diarahkan kembali ke Welcome dengan penjelasan", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#authTitle")).toHaveText("Masuk sebagai");
    await expect(page.locator("#prompt")).toBeVisible();
    await page.waitForLoadState("networkidle");                 // riwayat selesai dimuat sebelum sesi "berakhir"
    app.db.sqlite.exec("DELETE FROM sessions");                 // sesi hilang/kedaluwarsa di server
    await send(page, "Halo");
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.locator("#gateNotice")).toContainText("Sesi Anda berakhir");
    await expect(page.locator("#app")).toBeHidden();
  });

  test("logout mengakhiri sesi, membersihkan state klien, dan tidak menghapus chat permanen", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    seedConversation(app.db, { id: "conv-alice-0001", userId: ALICE.id, title: "Chat Alice", updatedAt: 100, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "halo" }] });
    await page.goto(app.url);
    if (drawerMode(page)) await page.locator("#menuBtn").click();
    await expect(page.locator(".history-item")).toHaveCount(1);
    await page.locator("#signOut").click();
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.locator("#app")).toBeHidden();
    expect(await page.evaluate(() => document.getElementById("history").children.length)).toBe(0);
    expect((await (await page.request.get(app.url + "/api/auth/me")).json()).authenticated).toBe(false);
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM conversations").get().n).toBe(1);
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM sessions").get().n).toBe(0);
  });

  test("gagal memeriksa status akun menampilkan error yang jelas, bisa dicoba ulang, dan Guest tetap tersedia", async ({ page, app }) => {
    let fail = true;
    await page.route("**/api/auth/me", (route) => (fail ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"x"}' }) : route.continue()));
    await page.goto(app.url);
    await expect(page.locator("#gateNotice")).toContainText("tidak dapat diperiksa");
    await expect(page.locator("#continueGuest")).toBeVisible();
    fail = false;
    await page.locator("#gateRetry").click();
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.locator("#gateNotice")).toBeHidden();
    await expect(page.locator("#gateRetry")).toBeHidden();
  });

  test.describe("Google belum dikonfigurasi", () => {
    test.use({ harnessOptions: { googleClientId: "" } });
    test("tombol Google dinonaktifkan dengan alasan; Guest tetap bisa dipakai", async ({ page, app }) => {
      await page.goto(app.url);
      await expect(page.locator("#googleDisabled")).toBeVisible();
      await expect(page.locator("#googleDisabled")).toBeDisabled();
      await expect(page.locator("#googleReason")).toContainText("belum dikonfigurasi");
      await page.locator("#continueGuest").click();
      await expect(page.locator("#app")).toBeVisible();
    });
  });

  test("token Google tidak valid ditolak server: tetap di Welcome, ada pesan error, tidak ada sesi dibuat", async ({ page, app }) => {
    await page.goto(app.url);
    await page.locator("#googleButtonGate .gsi-stub").click();
    await expect(page.locator("#toast")).toContainText(/gagal/i);
    await expect(page.locator("#gate")).toBeVisible();
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM sessions").get().n).toBe(0);
  });

  test("nonce Google diperbarui otomatis saat halaman dibiarkan terbuka (>4 menit)", async ({ page, app }) => {
    await page.clock.install();
    await page.goto(app.url);
    await expect(page.locator("#googleButtonGate .gsi-stub")).toBeVisible();
    expect(await page.evaluate(() => window.__gsiInits)).toBe(1);
    await page.clock.fastForward(5 * 60 * 1000);
    await expect.poll(() => page.evaluate(() => window.__gsiInits)).toBeGreaterThan(1);
  });
});

test.describe("NAV — drawer, Back/Forward, rute", () => {
  test("drawer tertutup saat pertama dibuka dan tidak bisa difokus lewat Tab (mode drawer); sidebar tetap tampil di desktop", async ({ page, app }) => {
    await enterGuest(page, app);
    if (drawerMode(page)) {
      await expect(page.locator("#sidebar")).toBeHidden();
      await expect(page.locator("#menuBtn")).toBeVisible();
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => !!document.activeElement.closest("#sidebar"))).toBe(false);
      }
    } else {
      await expect(page.locator("#sidebar")).toBeVisible();
      await expect(page.locator("#menuBtn")).toBeHidden();
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("drawer: buka, tutup lewat backdrop / tombol tutup / Escape; scroll terkunci; fokus kembali ke tombol menu", async ({ page, app }) => {
    test.skip(!drawerMode(page), "hanya mode drawer");
    await enterGuest(page, app);
    const closers = [
      () => page.mouse.click(page.viewportSize().width - 8, page.viewportSize().height / 2), // sisi kanan = backdrop; sisi kiri tertutup sidebar
      () => page.locator("#drawerClose").click(),
      () => page.keyboard.press("Escape")
    ];
    for (const close of closers) {
      await page.locator("#menuBtn").click();
      await expect(page.locator("#sidebar")).toBeVisible();
      await expect(page.locator("#backdrop")).toBeVisible();
      await expect(page.locator("#menuBtn")).toHaveAttribute("aria-expanded", "true");
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
      expect(await page.evaluate(() => document.getElementById("workspace").inert)).toBe(true);
      await close();
      await expect(page.locator("#sidebar")).toBeHidden();
      await expect(page.locator("#menuBtn")).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
      expect(await page.evaluate(() => document.activeElement.id)).toBe("menuBtn");
    }
  });

  test("Back menutup drawer lebih dulu (bukan keluar aplikasi); Back berikutnya keluar; Forward membuka drawer lagi", async ({ page, app }) => {
    test.skip(!drawerMode(page), "hanya mode drawer");
    await page.goto("about:blank");
    await enterGuest(page, app);
    await page.locator("#menuBtn").click();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#app")).toBeVisible();
    expect(page.url().startsWith(app.url)).toBe(true);
    await page.goForward();
    await expect(page.locator("#sidebar")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#sidebar")).toBeHidden();
    await page.goBack();                                       // tidak ada lagi entri in-app → perilaku browser normal
    await expect.poll(() => page.url()).toBe("about:blank");
  });

  test("buka/tutup drawer berulang tidak menumpuk riwayat (tanpa loop popstate)", async ({ page, app }) => {
    test.skip(!drawerMode(page), "hanya mode drawer");
    await enterGuest(page, app);
    const lengths = [];
    for (let i = 0; i < 4; i++) {
      await page.locator("#menuBtn").click();
      await expect(page.locator("#sidebar")).toBeVisible();
      lengths.push(await page.evaluate(() => history.length));
      await page.locator("#drawerClose").click();
      await expect(page.locator("#sidebar")).toBeHidden();
    }
    expect(new Set(lengths).size).toBe(1);
  });

  test("Back/Forward antar-chat: rute in-app dipulihkan, drawer tidak tersangkut", async ({ page, app }) => {
    await enterGuest(page, app);
    const open = async () => { if (drawerMode(page)) { await page.locator("#menuBtn").click(); await expect(page.locator("#sidebar")).toBeVisible(); } };
    await send(page, "Pesan pertama");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const hashA = await page.evaluate(() => location.hash);
    expect(hashA).toMatch(/^#\/c\//);
    await open();
    await page.locator("#newChat").click();
    await expect(page.locator("#welcome")).toBeVisible();
    if (drawerMode(page)) await expect(page.locator("#sidebar")).toBeHidden();
    expect(await page.evaluate(() => location.hash)).toBe("#/");
    await send(page, "Pesan kedua");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const hashB = await page.evaluate(() => location.hash);
    expect(hashB).not.toBe(hashA);
    await page.goBack();                                         // → chat A (rute "#/")? lihat urutan: B menggantikan "#/", jadi Back ke A
    await expect(page.locator(".message.user .message-body")).toContainText("Pesan pertama");
    expect(await page.evaluate(() => location.hash)).toBe(hashA);
    if (drawerMode(page)) await expect(page.locator("#sidebar")).toBeHidden();
    await page.goForward();
    await expect(page.locator(".message.user .message-body")).toContainText("Pesan kedua");
    expect(await page.evaluate(() => location.hash)).toBe(hashB);
  });

  test("memilih chat dari drawer menutup drawer dan Back kembali ke rute sebelumnya (bukan ke drawer)", async ({ page, app }) => {
    test.skip(!drawerMode(page), "hanya mode drawer");
    await enterGuest(page, app);
    await send(page, "Satu"); await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    await page.locator("#menuBtn").click(); await page.locator("#newChat").click();
    await send(page, "Dua"); await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const hashB = await page.evaluate(() => location.hash);
    await page.locator("#menuBtn").click();
    await page.locator(".history-item", { hasText: "Satu" }).click();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator(".message.user .message-body")).toContainText("Satu");
    await page.goBack();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator(".message.user .message-body")).toContainText("Dua");
    expect(await page.evaluate(() => location.hash)).toBe(hashB);
  });

  test("rute langsung & refresh: chat milik akun dibuka dari URL; chat milik orang lain ditolak dan URL dinormalkan", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    seedConversation(app.db, { id: "conv-alice-0001", userId: ALICE.id, title: "Rencana Alice", updatedAt: 200, messages: [{ role: "user", content: "pertanyaan alice" }, { role: "assistant", content: "jawaban alice" }] });
    seedSession(app.db, BOB);
    seedConversation(app.db, { id: "conv-bob-000001", userId: BOB.id, title: "Rahasia Bob", updatedAt: 300, messages: [{ role: "user", content: "rahasia bob" }, { role: "assistant", content: "ok" }] });
    await page.goto(app.url + "/#/c/conv-alice-0001");
    await expect(page.locator(".message.user .message-body")).toContainText("pertanyaan alice");
    await page.reload();
    await expect(page.locator(".message.user .message-body")).toContainText("pertanyaan alice");
    await page.goto(app.url + "/#/c/conv-bob-000001");
    await page.reload();
    await expect(page.locator("#toast")).toContainText("tidak ditemukan");
    await expect(page.locator(".message")).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe("#/");
    expect(await page.evaluate(() => document.body.innerText)).not.toContain("rahasia bob");
  });

  test("riwayat akun diurutkan terbaru di atas, dan chat yang baru dibalas naik ke atas", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    const now = Math.floor(Date.now() / 1000) - 1000;
    seedConversation(app.db, { id: "conv-newest-0001", userId: ALICE.id, title: "NEWEST", updatedAt: now + 300 });
    seedConversation(app.db, { id: "conv-middle-0002", userId: ALICE.id, title: "MIDDLE", updatedAt: now + 200 });
    seedConversation(app.db, { id: "conv-oldest-0003", userId: ALICE.id, title: "OLDEST", updatedAt: now + 100 });
    await page.goto(app.url);
    if (drawerMode(page)) await page.locator("#menuBtn").click();
    const titles = () => page.locator(".history-item span:not([aria-hidden])").allTextContents();
    await expect(page.locator(".history-item")).toHaveCount(3);
    expect(await titles()).toEqual(["NEWEST", "MIDDLE", "OLDEST"]);
    await page.locator(".history-item", { hasText: "OLDEST" }).click();
    await send(page, "Halo lagi");
    await expect(page.locator(".message.assistant:not(#typing)").last()).toContainText("Balasan uji");
    if (drawerMode(page)) await page.locator("#menuBtn").click();
    await expect.poll(async () => (await titles())[0]).toBe("OLDEST");
  });

  test("REGRESI: klik chat lama lalu langsung mengetik (pemuatan lambat) tidak membuat chat baru atau membelokkan pesan", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    const now = Math.floor(Date.now() / 1000) - 1000;
    seedConversation(app.db, { id: "conv-lama-000001", userId: ALICE.id, title: "Chat lama", updatedAt: now, messages: [{ role: "user", content: "isi lama" }, { role: "assistant", content: "jawaban lama" }] });
    await page.route("**/api/conversations/conv-lama-000001", async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
    await page.goto(app.url);
    if (drawerMode(page)) await page.locator("#menuBtn").click();
    await expect(page.locator(".history-item")).toHaveCount(1);
    await page.locator(".history-item").click();
    await send(page, "lanjutan di chat lama");              // fill menunggu composer bisa diedit (terkunci selama memuat)
    await expect(page.locator(".message.assistant:not(#typing)").last()).toContainText("Balasan uji");
    await expect(page.locator(".message.user .message-body").first()).toContainText("isi lama");
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM conversations WHERE user_id = ?").get(ALICE.id).n).toBe(1);
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id = 'conv-lama-000001'").get().n).toBe(4);
  });

  test("composer: Shift+Enter baris baru, Enter kirim, dan double-submit dicegah", async ({ page, app }) => {
    await enterGuest(page, app);
    const posts = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/chat") && r.method() === "POST") posts.push(r); });
    await page.locator("#prompt").fill("baris1");
    await page.locator("#prompt").press("Shift+Enter");
    await page.locator("#prompt").type("baris2");
    expect(await page.locator("#prompt").inputValue()).toBe("baris1\nbaris2");
    await page.locator("#prompt").press("Enter");
    await page.locator("#prompt").press("Enter");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    expect(posts.length).toBe(1);
  });

  test("tidak ada overflow horizontal pada Welcome maupun chat dengan teks panjang", async ({ page, app }) => {
    await page.goto(app.url);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.locator("#continueGuest").click();
    await send(page, "x".repeat(400));
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});

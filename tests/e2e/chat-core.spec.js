import { test, expect, loginAs } from "./fixtures.js";

const ALICE = { id: "google-sub-alice", email: "alice@example.com", name: "Alice" };
const sentTurns = (call) => call.messages.filter((m) => m.role !== "system").map((m) => m.content);

async function enterGuest(page, app) {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
}
async function send(page, text) {
  await page.locator("#prompt").fill(text);
  await page.locator("#prompt").press("Enter");
}

test.describe("CHAT — memori percakapan, kegagalan, batas laju", () => {
  test("guest: pesan kedua membawa konteks pesan pertama (multi-turn)", async ({ page, app }) => {
    await enterGuest(page, app);
    await send(page, "Nama saya Budi.");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    await send(page, "Siapa nama saya?");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(2);
    const turns = sentTurns(app.aiCalls.at(-1));
    expect(turns[0]).toBe("Nama saya Budi.");
    expect(turns[1]).toContain("Balasan uji");
    expect(turns.at(-1)).toBe("Siapa nama saya?");
  });

  test("chat baru tidak membawa konteks chat lain", async ({ page, app }) => {
    await enterGuest(page, app);
    await send(page, "Rahasia-chat-satu");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    if (page.viewportSize().width <= 1024) await page.locator("#menuBtn").click();
    await page.locator("#newChat").click();
    await send(page, "Topik lain");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    expect(JSON.stringify(sentTurns(app.aiCalls.at(-1)))).not.toContain("Rahasia-chat-satu");
  });

  test("akun: konteks dimuat dari database untuk giliran berikutnya, juga setelah refresh", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await send(page, "Kota saya Bogor.");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/c\//);
    await page.reload();
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    await send(page, "Di kota mana saya tinggal?");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(2);
    const turns = sentTurns(app.aiCalls.at(-1));
    expect(turns[0]).toBe("Kota saya Bogor.");
    expect(turns.at(-1)).toBe("Di kota mana saya tinggal?");
  });

  test("REGRESI: mengirim pesan saat riwayat akun masih dimuat tidak menghilangkan jawaban", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.route("**/api/conversations", async (route) => { if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
    await page.goto(app.url);
    await expect(page.locator("#app")).toBeVisible();
    await send(page, "Dikirim saat riwayat memuat");           // fill menunggu composer terbuka kuncinya
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    await expect(page.locator(".message.user .message-body")).toContainText("Dikirim saat riwayat memuat");
    expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM conversations").get().n).toBe(1);
  });

  test("AI gagal: tampil pesan jelas + Coba lagi; tidak ada yang tersimpan; retry berhasil tanpa duplikat; konteks tetap bersih", async ({ page, app, context }) => {
    await loginAs(context, app, ALICE);
    await page.goto(app.url);
    await expect(page.locator("#prompt")).toBeVisible();
    await send(page, "Pesan pertama berhasil");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const stored = () => app.db.sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n;
    expect(stored()).toBe(2);

    app.control.aiFail = true;
    await send(page, "Pesan kedua gagal");
    await expect(page.locator(".message.failed")).toHaveCount(1);
    await expect(page.locator(".retry-btn")).toBeVisible();
    await expect(page.locator("#prompt")).toBeEditable();        // composer tidak macet setelah gagal
    expect(stored()).toBe(2);                                    // tidak ada setengah-simpan

    app.control.aiFail = false;
    await page.locator(".retry-btn").click();
    await expect(page.locator(".message.failed")).toHaveCount(0);
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(2);
    await expect(page.locator(".message.user .message-body", { hasText: "Pesan kedua gagal" })).toHaveCount(1); // tidak duplikat
    expect(stored()).toBe(4);

    await send(page, "Pesan ketiga");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(3);
    const turns = sentTurns(app.aiCalls.at(-1));
    expect(turns.filter((t) => t === "Pesan kedua gagal").length).toBe(1);   // hanya satu kali dalam konteks
    expect(turns.join("\n")).not.toContain("Maaf, permintaan gagal");        // pesan error tidak pernah jadi konteks
  });

  test("guest: giliran yang gagal tidak mencemari konteks berikutnya, dan hilang setelah memuat ulang chat", async ({ page, app }) => {
    await enterGuest(page, app);
    await send(page, "Halo pertama");
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    app.control.aiFail = true;
    await send(page, "Yang gagal");
    await expect(page.locator(".message.failed")).toHaveCount(1);
    app.control.aiFail = false;
    await send(page, "Lanjut biasa");                            // tanpa menekan Coba lagi
    await expect(page.locator(".message.assistant:not(#typing)").last()).toContainText("Balasan uji");
    const joined = sentTurns(app.aiCalls.at(-1)).join("\n");
    expect(joined).toContain("Halo pertama");
    expect(joined).not.toContain("Yang gagal");
    expect(joined).not.toContain("Maaf, permintaan gagal");
  });

  test.describe("batas laju", () => {
    test.use({ harnessOptions: { chatLimit: 1 } });
    test("429 ditampilkan sebagai pesan yang bisa dipahami dan bisa dicoba lagi", async ({ page, app }) => {
      await enterGuest(page, app);
      await send(page, "Pertama");
      await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
      await send(page, "Kedua");
      await expect(page.locator(".message.failed")).toContainText("Terlalu banyak permintaan");
      await expect(page.locator(".retry-btn")).toBeVisible();
    });
  });
});

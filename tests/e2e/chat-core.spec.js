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
  await page.locator("#send").click();
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

test("server macet: permintaan dibatalkan setelah batas waktu, ada pesan jelas + Coba lagi, composer tidak terkunci selamanya", async ({ page, app }) => {
  await page.clock.install();
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  app.control.aiHang = true;                                   // server tidak pernah menjawab
  await page.locator("#prompt").fill("Tolong jawab");
  await page.locator("#send").click();
  await expect(page.locator("#typing")).toBeVisible();
  await page.clock.fastForward(151_000);                      // melewati CHAT_TIMEOUT_MS
  await expect(page.locator(".message.failed")).toContainText("terlalu lama merespons");
  await expect(page.locator(".retry-btn")).toBeVisible();
  await expect(page.locator("#prompt")).toBeEditable();
  await expect(page.locator("#send")).toBeEnabled();
  app.control.aiHang = false;
  await page.locator(".retry-btn").click();
  await expect(page.locator(".message.assistant:not(#typing):not(.failed)")).toHaveCount(1);
});

test.describe("batas harian", () => {
  test.use({ harnessOptions: { extraEnv: { DAILY_LIMIT_GUEST: "1" } } });
  test("saat batas tercapai: pesan jelas dengan arahan masuk Google, tanpa tombol Coba lagi, kolom ketik tetap normal", async ({ page, app }) => {
    await page.goto(app.url);
    await page.locator("#continueGuest").click();
    await page.locator("#prompt").fill("Pesan pertama");
    await page.locator("#send").click();
    await expect(page.locator(".message.assistant:not(#typing):not(.failed)")).toHaveCount(1);
    await page.locator("#prompt").fill("Pesan kedua");
    await page.locator("#send").click();
    await expect(page.locator(".message.failed")).toContainText("Batas harian tamu tercapai");
    await expect(page.locator(".message.failed")).toContainText("Masuk dengan Google");
    await expect(page.locator(".retry-btn")).toHaveCount(0);
    await expect(page.locator("#prompt")).toBeEditable();
    await expect(page.locator("#send")).toBeEnabled();
  });
});

test.describe("pembaca link", () => {
  const PAGE = '<html><head><title>Judul &lt;img src=x onerror=window.__xss=1&gt; Aman</title></head><body><p>Isi halaman yang cukup panjang supaya dianggap berisi teks yang berguna oleh pembaca link.</p></body></html>';
  test.use({ harnessOptions: { extraEnv: { LINK_FETCHER: async (url) => url.includes("rusak") ? new Response("x", { status: 500 }) : new Response(PAGE, { headers: { "content-type": "text/html" } }) } } });

  test("jawaban menampilkan tautan yang berhasil dan yang gagal beserta alasannya; judul berbahaya tampil sebagai teks", async ({ page, app }) => {
    await page.goto(app.url);
    await page.locator("#continueGuest").click();
    await page.locator("#prompt").fill("Tolong ringkas https://contoh.id/a dan https://rusak.id/b");
    await page.locator("#send").click();
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const sources = page.locator(".sources");
    await expect(sources).toBeVisible();
    await expect(sources).toContainText("Tautan yang dibaca");
    await expect(sources.locator(".source.ok")).toContainText("contoh.id");
    await expect(sources.locator(".source.fail")).toContainText("rusak.id");
    await expect(sources.locator(".source.fail")).toContainText("500");
    await expect(sources).toContainText("<img src=x");                         // tampil sebagai teks
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator(".sources img").count()).toBe(0);
    await expect(page.locator("#prompt")).toBeEditable();
  });
});

test("mode Translator dan Text Analyst tersedia di pemilih mode dan terkirim ke server", async ({ page, app }) => {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  const options = await page.locator("#agent option").evaluateAll((els) => els.map((e) => e.value));
  expect(options).toEqual(expect.arrayContaining(["translator", "text_analyst"]));
  const posts = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/chat") && r.method() === "POST") posts.push(JSON.parse(r.postData())); });
  await page.locator("#agent").selectOption("translator");
  await page.locator("#prompt").fill("Translate to Indonesian: Good morning");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  expect(posts[0].agent).toBe("translator");
});



test("akun: pencarian riwayat menemukan percakapan berdasarkan isi pesan dan dapat di-reset", async ({ page, app, context }) => {
  await loginAs(context, app, ALICE);
  await page.goto(app.url);
  await expect(page.locator("#prompt")).toBeVisible();
  await send(page, "Cari-frasa-unik untuk pengujian riwayat");
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  if (page.viewportSize().width <= 1024) await page.locator("#menuBtn").click();
  await page.locator("#historySearch").fill("frasa-unik");
  await page.locator("#historySearchForm").evaluate(form => form.requestSubmit());
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".history-item")).toContainText("Cari-frasa-unik");
  await page.locator("#historySearch").press("Escape");
  await expect(page.locator("#historySearch")).toHaveValue("");
  await expect(page.locator(".history-row")).toHaveCount(1);
});

test("akun: judul percakapan dapat diubah dan tetap tersimpan setelah reload", async ({ page, app, context }) => {
  await loginAs(context, app, ALICE);
  await page.goto(app.url);
  await expect(page.locator("#prompt")).toBeVisible();
  await send(page, "Judul awal percakapan");
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  // Mobile/tablet layouts keep conversation history inside the closed navigation drawer.
  if (page.viewportSize().width <= 1024) await page.locator("#menuBtn").click();

  page.on("dialog", (dialog) => dialog.accept("Judul hasil edit"));
  await page.getByRole("button", { name: "Ubah judul Judul awal percakapan" }).click();
  await expect(page.locator(".history-item")).toContainText("Judul hasil edit");

  await page.reload();
  await expect(page.locator(".history-item")).toContainText("Judul hasil edit");
  expect(app.db.sqlite.prepare("SELECT title FROM conversations").get().title).toBe("Judul hasil edit");
});


test("akun: pesan terakhir dapat diedit dan jawaban dapat dibuat ulang", async ({ page, app, context }) => {
  await loginAs(context, app, ALICE);
  await page.goto(app.url);
  await expect(page.locator("#prompt")).toBeVisible();
  await send(page, "Pertanyaan versi awal");
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".edit-message")).toBeVisible();
  await expect(page.locator(".regenerate-message")).toBeVisible();

  page.once("dialog", dialog => dialog.accept("Pertanyaan versi edit"));
  await page.locator(".edit-message").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".message.user .message-text")).toContainText("Pertanyaan versi edit");
  expect(app.db.sqlite.prepare("SELECT content FROM messages WHERE role = 'user'").all().map(r => r.content)).toEqual(["Pertanyaan versi edit"]);

  await page.locator(".regenerate-message").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n).toBe(2);
  expect(app.db.sqlite.prepare("SELECT content FROM messages WHERE role = 'user'").get().content).toBe("Pertanyaan versi edit");
  expect(app.aiCalls.length).toBe(3);
});

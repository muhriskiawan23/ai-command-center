import { test, expect } from "./fixtures.js";

async function enterGuest(page, app) {
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#app")).toBeVisible();
}
const metrics = (page) => page.evaluate(() => {
  const el = document.getElementById("prompt");
  return { h: el.getBoundingClientRect().height, scrollH: el.scrollHeight, clientH: el.clientHeight, overflowY: getComputedStyle(el).overflowY, max: parseFloat(getComputedStyle(el).maxHeight) };
});
const lines = (n) => Array.from({ length: n }, (_, i) => `baris ${i + 1}`).join("\n");

test.describe("INPUT — Enter = baris baru, tombol panah = kirim", () => {
  test("Enter (dan Shift+Enter) membuat baris baru dan TIDAK mengirim pesan", async ({ page, app }) => {
    await enterGuest(page, app);
    const posts = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/chat") && r.method() === "POST") posts.push(r); });
    const box = page.locator("#prompt");
    await box.click();
    await box.pressSequentially("baris1");
    await box.press("Enter");
    await box.pressSequentially("baris2");
    await box.press("Shift+Enter");
    await box.pressSequentially("baris3");
    expect(await box.inputValue()).toBe("baris1\nbaris2\nbaris3");
    await page.waitForTimeout(300);
    expect(posts.length).toBe(0);
    await expect(page.locator(".message")).toHaveCount(0);
  });

  test("tidak ada pintasan keyboard lain yang mengirim (Ctrl+Enter, Meta+Enter)", async ({ page, app }) => {
    await enterGuest(page, app);
    const posts = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/chat")) posts.push(r); });
    const box = page.locator("#prompt");
    await box.fill("tes");
    await box.press("Control+Enter");
    await box.press("Meta+Enter");
    await page.waitForTimeout(300);
    expect(posts.length).toBe(0);
  });

  test("tombol panah mengirim satu kali dan baris baru tetap utuh", async ({ page, app }) => {
    await enterGuest(page, app);
    const posts = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/chat") && r.method() === "POST") posts.push(JSON.parse(r.postData())); });
    await page.locator("#prompt").fill("baris1\nbaris2");
    await page.locator("#send").click();
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    expect(posts.length).toBe(1);
    expect(posts[0].message).toBe("baris1\nbaris2");
    await expect(page.locator(".message.user")).toHaveCount(1);
  });

  test("tombol panah di kolom kosong atau hanya spasi tidak mengirim apa pun", async ({ page, app }) => {
    await enterGuest(page, app);
    const posts = [];
    page.on("request", (r) => { if (r.url().endsWith("/api/chat")) posts.push(r); });
    await page.locator("#send").click();
    await page.locator("#prompt").fill("   \n  ");
    await page.locator("#send").click();
    await page.waitForTimeout(300);
    expect(posts.length).toBe(0);
  });

  test("auto-expand: tinggi bertambah mengikuti baris, berhenti di batas, lalu scroll internal; kembali kecil setelah kirim", async ({ page, app }) => {
    await enterGuest(page, app);
    const box = page.locator("#prompt");
    const start = await metrics(page);
    await box.fill(lines(4)); await box.dispatchEvent("input");
    const four = await metrics(page);
    expect(four.h).toBeGreaterThan(start.h + 20);
    expect(four.overflowY).toBe("hidden");                 // belum mencapai batas: tanpa scrollbar

    await box.fill(lines(60)); await box.dispatchEvent("input");
    const many = await metrics(page);
    expect(many.h).toBeLessThanOrEqual(many.max + 1);      // tidak melewati batas
    expect(many.max).toBeGreaterThan(0);
    expect(many.h).toBeLessThan(page.viewportSize().height * 0.5);   // tidak memenuhi layar
    expect(many.overflowY).toBe("auto");
    expect(many.scrollH).toBeGreaterThan(many.clientH);    // isi lebih panjang dari kotak → bisa di-scroll
    const scrolled = await page.evaluate(() => { const el = document.getElementById("prompt"); el.scrollTop = 99999; return el.scrollTop; });
    expect(scrolled).toBeGreaterThan(0);

    await page.locator("#send").click();
    await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
    const after = await metrics(page);
    expect(after.h).toBeLessThan(start.h + 5);              // kolom kembali ke ukuran awal
  });

  test("tombol kirim tetap terlihat dan tidak keluar layar saat kolom input penuh", async ({ page, app }) => {
    await enterGuest(page, app);
    await page.locator("#prompt").fill(lines(60));
    await page.locator("#prompt").dispatchEvent("input");
    const vp = page.viewportSize();
    const send = await page.locator("#send").boundingBox();
    const box = await page.locator("#prompt").boundingBox();
    expect(send.y).toBeGreaterThanOrEqual(0); expect(send.y + send.height).toBeLessThanOrEqual(vp.height);
    expect(send.x + send.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("EMULASI keyboard virtual: saat tinggi viewport menyusut, kolom input dan tombol kirim tetap terlihat; layout pulih saat keyboard hilang", async ({ page, app }) => {
    // Ini hanya mengecilkan viewport untuk meniru keyboard; BUKAN pengujian keyboard Android/iOS sungguhan.
    await enterGuest(page, app);
    const full = page.viewportSize();
    await page.locator("#prompt").fill(lines(12));
    await page.locator("#prompt").dispatchEvent("input");
    const keyboard = Math.round(full.height * 0.45);
    await page.setViewportSize({ width: full.width, height: full.height - keyboard });
    await page.waitForTimeout(150);
    const vp = page.viewportSize();
    const box = await page.locator("#prompt").boundingBox();
    const send = await page.locator("#send").boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    expect(send.y + send.height).toBeLessThanOrEqual(vp.height);
    expect(box.height).toBeLessThan(vp.height * 0.6);       // batas tinggi mengikuti layar yang menyusut
    await page.setViewportSize(full);
    await page.waitForTimeout(150);
    const back = await page.locator("#send").boundingBox();
    expect(back.y + back.height).toBeLessThanOrEqual(full.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("atribut keyboard mobile: enterkeyhint=enter dan petunjuk teks sesuai perilaku baru", async ({ page, app }) => {
    await enterGuest(page, app);
    await expect(page.locator("#prompt")).toHaveAttribute("enterkeyhint", "enter");
    const language = await page.locator("html").getAttribute("lang");
    const expectedHint = language === "en" ? "Enter = new line" : "Enter = baris baru";
    await expect(page.locator(".hint")).toContainText(expectedHint);
    expect(await page.locator("#chatForm").getAttribute("action")).toBeNull();   // tidak ada submit native ke server
  });
});

test("pemilihan bahasa Arab menerapkan locale dan arah RTL", async ({ page, app }) => {
  await enterGuest(page, app);
  const picker = page.locator("#languagePreference");
  await expect(picker).toBeVisible();
  await picker.selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(picker).toHaveValue("ar");
});


test("runtime localization covers action labels and attributes across all supported locales", async ({ page, app }) => {
  await enterGuest(page, app);
  const locales = ["en", "id", "es", "fr", "de", "pt", "ja", "ko", "zh", "ar"];
  for (const locale of locales) {
    await page.evaluate((code) => window.BORLocale.apply(code), locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const translated = await page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "Ekspor chat";
      button.title = "Ekspor chat";
      document.body.append(button);
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const result = {
            text: button.textContent,
            title: button.title,
            direction: document.documentElement.dir,
            service: window.BORLocale.translate("Layanan tidak aktif"),
            github: window.BORLocale.translate("Hubungkan akun GitHub")
          };
          button.remove();
          resolve(result);
        }));
      });
    });
    if (locale === "id") {
      expect(translated.text).toBe("Ekspor chat");
      expect(translated.title).toBe("Ekspor chat");
    } else {
      expect(translated.text).not.toBe("Ekspor chat");
      expect(translated.title).not.toBe("Ekspor chat");
    }
    expect(translated.direction).toBe(locale === "ar" ? "rtl" : "ltr");
    if (locale === "id") {
      expect(translated.service).toBe("Layanan tidak aktif");
      expect(translated.github).toBe("Hubungkan akun GitHub");
    } else {
      expect(translated.service).not.toBe("Layanan tidak aktif");
      expect(translated.github).not.toBe("Hubungkan akun GitHub");
    }
  }
});


test("Arabic RTL positions the desktop sidebar on the right and opens the mobile drawer from the right", async ({ page, app }) => {
  await enterGuest(page, app);
  await page.evaluate(() => window.BORLocale.apply("ar"));
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopSidebar = await page.locator("#sidebar").boundingBox();
  const desktopWorkspace = await page.locator("#workspace").boundingBox();
  expect(desktopSidebar.x).toBeGreaterThan(desktopWorkspace.x);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#menuBtn").click();
  await expect(page.locator("#sidebar")).toHaveClass(/open/);
  const mobileSidebar = await page.locator("#sidebar").boundingBox();
  const layoutViewportWidth = await page.evaluate(() => window.innerWidth);
  expect(mobileSidebar.x).toBeGreaterThanOrEqual(0);
  expect(mobileSidebar.x + mobileSidebar.width).toBeLessThanOrEqual(layoutViewportWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

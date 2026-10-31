import { test as base, expect } from "@playwright/test";
import { startHarness, seedSession, seedConversation } from "./harness.js";
export { expect, seedSession, seedConversation };

// Pengganti SDK Google (tidak ada akses jaringan ke Google di test). Hanya untuk UI; verifikasi token tetap dilakukan Worker asli.
const GSI_STUB = `
window.__gsiInits = 0;
window.google = { accounts: { id: {
  initialize(cfg) { window.__gsi = cfg; window.__gsiInits++; },
  renderButton(el) { el.innerHTML = '<button type="button" class="gsi-stub">Sign in with Google</button>'; el.firstChild.onclick = () => window.__gsi.callback({ credential: "bukan.token.valid" }); },
  disableAutoSelect() {}
} } };`;

// Merekam apakah UI chat / judul "Guest Mode" pernah terlihat (mendeteksi "auth flash").
const FLASH_RECORDER = `
window.__seen = { appVisible: false, authTitles: [] };
new MutationObserver(() => {
  const app = document.getElementById("app");
  if (app && !app.hidden) {
    window.__seen.appVisible = true;
    const t = document.getElementById("authTitle")?.textContent;
    if (t && !window.__seen.authTitles.includes(t)) window.__seen.authTitles.push(t);
  }
}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });`;

export const test = base.extend({
  harnessOptions: [{}, { option: true }],
  app: async ({ harnessOptions }, use) => { const h = await startHarness(harnessOptions); await use(h); await h.close(); },
  page: async ({ page }, use) => {
    await page.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: GSI_STUB }));
    await page.addInitScript(FLASH_RECORDER);
    await use(page);
  }
});

export async function loginAs(context, app, user) {
  const token = seedSession(app.db, user);
  const res = await context.request.get(`${app.url}/__test/login?token=${token}`);
  if (res.status() !== 204) throw new Error("gagal menanam cookie sesi uji");
  return token;
}
export const drawerMode = (page) => page.viewportSize().width <= 1024;

import { defineConfig } from "@playwright/test";

// Viewport wajib dari spesifikasi: 360x800, 375x812, 390x844, 412x915, tablet, desktop, portrait/landscape.
const phone = (name, width, height) => ({ name, use: { viewport: { width, height }, isMobile: true, hasTouch: true } });
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  use: {
    // Di CI: `npx playwright install chromium`. Secara lokal bisa diarahkan ke Chromium yang sudah ada.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined }
  },
  projects: [
    phone("phone-360x800", 360, 800),
    phone("phone-375x812", 375, 812),
    phone("phone-390x844", 390, 844),
    phone("phone-412x915", 412, 915),
    phone("phone-landscape-915x412", 915, 412),
    phone("tablet-768x1024", 768, 1024),
    { name: "tablet-landscape-1024x768", use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: "desktop-1280x800", use: { viewport: { width: 1280, height: 800 } } }
  ]
});

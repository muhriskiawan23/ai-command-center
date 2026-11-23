import { defineConfig } from "@playwright/test";

// Jalankan seluruh matriks viewport setelah baseline stabil; di CI hentikan pada kegagalan
// pertama agar akar masalah tidak tertutup ratusan timeout berulang.
const phone = (name, width, height) => ({ name, use: { viewport: { width, height }, isMobile: true, hasTouch: true } });
const isCI = Boolean(process.env.CI);
// The dedicated BOR AI e2e workflow still runs all eight viewports.
// The additional workspace workflow duplicates that full suite and was cancelled
// at ~15 minutes (896 tests on two workers). Keep a representative responsive
// smoke matrix here to finish within the workspace workflow time budget.
const isWorkspaceWorkflow = isCI && process.env.GITHUB_WORKFLOW === "BOR AI workspace redesign (NO SECRETS)";
const workspaceSmokeProjects = new Set([
  "phone-390x844",
  "phone-landscape-915x412",
  "tablet-768x1024",
  "desktop-1280x800"
]);

const allProjects = [
  phone("phone-360x800", 360, 800),
  phone("phone-375x812", 375, 812),
  phone("phone-390x844", 390, 844),
  phone("phone-412x915", 412, 915),
  phone("phone-landscape-915x412", 915, 412),
  phone("tablet-768x1024", 768, 1024),
  { name: "tablet-landscape-1024x768", use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
  { name: "desktop-1280x800", use: { viewport: { width: 1280, height: 800 } } }
];

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: isCI ? 2 : undefined,
  maxFailures: isCI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Di CI: `npx playwright install chromium`. Secara lokal bisa diarahkan ke Chromium yang sudah ada.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined }
  },
  projects: (isWorkspaceWorkflow ? allProjects.filter((project) => workspaceSmokeProjects.has(project.name)) : allProjects)
});

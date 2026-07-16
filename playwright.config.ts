import { defineConfig, devices } from "@playwright/test";

const publicUrl = process.env.DUSK_STUDIO_PUBLIC_URL?.replace(/\/$/, "");

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: publicUrl ? [/assurance\.spec\.ts/, /studio\.spec\.ts/] : /public-release\.spec\.ts/,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "output/playwright-report", open: "never" }]] : "line",
  outputDir: "output/playwright",
  use: {
    baseURL: publicUrl ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: publicUrl ? undefined : {
    command: "pnpm build && pnpm --filter @dusk/studio preview",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } }
  ]
});

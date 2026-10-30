import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${port}{{BASE}}`,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    // service worker を通ると page.route で api.github.com をモックできない。
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run build && bunx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}{{BASE}}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

const port = 6007;

// 基準画像は CI (Linux) で作る。OS ごとに描画が違うので、Mac で作った画像を commit しない。
export default defineConfig({
  testDir: "./vrt",
  // ユニットテスト (bun test や vitest の既定パターン *.spec.ts / *.test.ts) に拾われないよう、拡張子を .vrt.ts にしている。
  testMatch: /.*\.vrt\.ts$/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  updateSnapshots: "none",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
  },
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${port}`,
    colorScheme: "light",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  webServer: {
    command: `bunx vite preview --outDir storybook-static --base / --port ${port} --strictPort`,
    url: `http://localhost:${port}/index.json`,
    reuseExistingServer: !process.env.CI,
  },
});

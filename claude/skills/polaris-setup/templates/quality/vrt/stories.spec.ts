import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

type IndexEntry = { id: string; type: "story" | "docs" };

const index = JSON.parse(readFileSync("storybook-static/index.json", "utf8")) as {
  entries: Record<string, IndexEntry>;
};
const stories = Object.values(index.entries).filter((entry) => entry.type === "story");

for (const { id } of stories) {
  const name = `${id}.png`;
  // 手元 (Mac) では基準が無いのが普通なので、落とさずに飛ばす。CI では基準の無い story を失敗にする。
  const hasBaseline = existsSync(`vrt/__screenshots__/${name}`);
  test(id, async ({ page }, testInfo) => {
    const isUpdating = testInfo.config.updateSnapshots !== "none";
    test.skip(!process.env.CI && !isUpdating && !hasBaseline, "基準無し");
    await page.goto(`/iframe.html?id=${id}&viewMode=story`);
    await page.locator("#storybook-root").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(name, { fullPage: true });
  });
}

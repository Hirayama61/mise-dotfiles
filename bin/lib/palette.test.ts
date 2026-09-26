import { describe, expect, test } from "bun:test";

import { loadPalette, parsePalette } from "./palette.ts";

describe("parsePalette", () => {
  describe('`PANDA_<色名>="R G B"` の行を受けたとき', () => {
    test("接頭辞を除いた色名をキーに RGB を返す", () => {
      const palette = parsePalette('PANDA_MINT="26 188 156"');

      expect(palette.get("MINT")).toEqual([26, 188, 156]);
    });
  });

  describe("コメント行・空行・形式の違う行が混ざっているとき", () => {
    test("定義の行だけを読み、他は無視する", () => {
      const source = [
        "# Panda の配色",
        "",
        'PANDA_FG="230 230 230"',
        'OTHER_COLOR="1 2 3"',
        'PANDA_BROKEN="not numbers"',
      ].join("\n");

      const palette = parsePalette(source);

      expect([...palette.keys()]).toEqual(["FG"]);
    });
  });
});

describe("loadPalette", () => {
  test("palette.sh から ui.ts が使う全色を読み込める", async () => {
    const palette = await loadPalette();

    const usedByUi = [
      "FG",
      "SUBTLE",
      "GRAY_LIFT",
      "MINT",
      "PINK",
      "CYAN",
      "PURPLE_LIFT",
      "BLUE_LIFT",
    ];
    for (const name of usedByUi) {
      expect(palette.get(name)).toBeDefined();
    }
  });
});

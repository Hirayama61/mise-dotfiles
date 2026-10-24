import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { loadPalette, type Rgb } from "../bin/lib/palette.ts";

// mise.toml の [vars] はテンプレート(config/**)が読む配色の写し。単一ソースは palette.sh。
const miseTomlPath = join(import.meta.dir, "..", "mise.toml");

type MiseToml = { vars?: Record<string, unknown> };

const toHex = ([red, green, blue]: Rgb): string =>
  `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;

const vars = (Bun.TOML.parse(await Bun.file(miseTomlPath).text()) as MiseToml).vars ?? {};
const palette = await loadPalette();

describe("mise.toml の [vars] の Panda 配色", () => {
  test("palette.sh の全色が panda_<name> として宣言されている", () => {
    const declared = Object.keys(vars).filter((key) => key.startsWith("panda_"));
    const expected = [...palette.keys()].map((name) => `panda_${name.toLowerCase()}`);
    expect(declared.toSorted()).toEqual(expected.toSorted());
  });

  for (const [name, rgb] of palette) {
    test(`panda_${name.toLowerCase()} は palette.sh の ${name} と同じ色`, () => {
      expect(vars[`panda_${name.toLowerCase()}`]).toBe(toHex(rgb));
    });
  }
});

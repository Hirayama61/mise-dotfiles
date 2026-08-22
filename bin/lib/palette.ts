import { join } from "node:path";

/** ANSI truecolor で使う RGB 値。 */
export type Rgb = readonly [number, number, number];

// 配色の単一ソースは palette.sh。値を TypeScript へ複製すると二重管理になるため、
// 実行時に shell の定義を解析する。
const palettePath = join(import.meta.dir, "palette.sh");

/**
 * Panda 配色を palette.sh から読み込む。
 *
 * @returns 接頭辞 PANDA_ を除いた色名をキーとする RGB の表。
 */
export const loadPalette = async (): Promise<ReadonlyMap<string, Rgb>> => {
  const source = await Bun.file(palettePath).text();
  const palette = new Map<string, Rgb>();

  for (const line of source.split("\n")) {
    const matched = /^PANDA_([A-Z_]+)="(\d+) (\d+) (\d+)"/.exec(line);
    const [, name, red, green, blue] = matched ?? [];
    if (name === undefined || red === undefined || green === undefined || blue === undefined) {
      continue;
    }
    palette.set(name, [Number(red), Number(green), Number(blue)]);
  }

  return palette;
};

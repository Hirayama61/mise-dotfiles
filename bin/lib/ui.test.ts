import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const runFixture = (name: string, input: string): { stdout: string; exitCode: number | null } => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", name)], {
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
};

// 末尾の JSON が ui-dialog.ts の実行結果。プロンプトは改行なしで手前に続く。
const dialogResult = (input: string): Record<string, unknown> => {
  const { stdout, exitCode } = runFixture("ui-dialog.ts", input);
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.slice(stdout.lastIndexOf("{"))) as Record<string, unknown>;
};

describe("createUi の表示部品", () => {
  describe("端末以外へ出力するとき", () => {
    const { stdout, exitCode } = runFixture("ui-render.ts", "");

    test("エスケープシーケンスを出さない", () => {
      expect(exitCode).toBe(0);
      expect(stdout).not.toInclude("\x1b");
    });

    test("status は ok を ✓、kept を · で区別する", () => {
      expect(stdout).toInclude("✓ gh            2.62.0");
      expect(stdout).toInclude("· user.name     octocat");
    });

    test("note は本文をそのまま 1 行で出す", () => {
      expect(stdout).toInclude("   補足の 1 行\n");
    });

    test("nextStep はコマンドを 24 桁に揃えて説明を続ける", () => {
      expect(stdout).toInclude("mise run setup          ツールと設定を適用する");
    });

    test("nextStep は 24 桁を超えるコマンドでも説明の前を 2 つ空ける", () => {
      expect(stdout).toInclude("very-long-command-over-24-columns  説明");
    });

    test("ready は準備完了の行を出す", () => {
      expect(stdout).toInclude("ready.  準備完了");
    });
  });
});

describe("ask", () => {
  describe("値を入力したとき", () => {
    test("入力した値を返す", () => {
      expect(dialogResult("custom\ny\n")).toEqual({ answer: "custom", confirmed: true });
    });
  });

  describe("空 Enter のとき", () => {
    test("既定値を返す", () => {
      expect(dialogResult("\ny\n")).toEqual({ answer: "DEF", confirmed: true });
    });
  });

  describe("入力が EOF で閉じられたとき", () => {
    test("中断のエラーになる", () => {
      expect(dialogResult("")).toEqual({ error: "入力が閉じられたため中断した" });
    });
  });
});

describe("confirm", () => {
  describe("空 Enter のとき", () => {
    test("Yes として扱う", () => {
      expect(dialogResult("x\n\n")).toEqual({ answer: "x", confirmed: true });
    });
  });

  describe("n と答えたとき", () => {
    test("No として扱う", () => {
      expect(dialogResult("x\nn\n")).toEqual({ answer: "x", confirmed: false });
    });
  });

  describe("入力が EOF で閉じられたとき", () => {
    // 改行で終わる入力は EOF の直前に空文字が 1 行湧くため、改行なしで閉じて EOF を作る。
    test("空 Enter と区別して No として扱う", () => {
      expect(dialogResult("x")).toEqual({ answer: "x", confirmed: false });
    });
  });
});

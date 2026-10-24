import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPalette, type Rgb } from "../../bin/lib/palette.ts";
import {
  brailleBar,
  formatTimeUntil,
  parseStatusLineInput,
  renderStatusLine,
  type StatusLineColors,
  type StatusLineState,
} from "./statusline.ts";

const scriptPath = join(import.meta.dir, "statusline.ts");

// 公式 docs(statusline.md)の Full JSON schema から、このスクリプトが読む項目を抜いたもの。
const docsExample = {
  cwd: "/current/working/directory",
  model: { id: "claude-opus-5-5", display_name: "Opus" },
  workspace: {
    current_dir: "/current/working/directory",
    project_dir: "/original/project/directory",
    added_dirs: [],
    git_worktree: "feature-xyz",
  },
  context_window: { used_percentage: 8, remaining_percentage: 92 },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
    seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
  },
  pr: {
    number: 1234,
    url: "https://github.com/anthropics/claude-code/pull/1234",
    review_state: "pending",
  },
};

// 5h 窓のリセットの 3 時間 5 分前。7d 窓はその 5 日後なので 5d3h。
const now = 1738425600 - (3 * 3600 + 5 * 60);

const plain = { now, colors: null, columns: null };

const palette = await loadPalette();
const color = (name: string): Rgb => {
  const rgb = palette.get(name);
  if (rgb === undefined) {
    throw new Error(`palette.sh に PANDA_${name} が無い`);
  }
  return rgb;
};
const colors: StatusLineColors = {
  mint: color("MINT"),
  orange: color("ORANGE"),
  red: color("RED"),
  subtle: color("SUBTLE"),
};
const escapeOf = ([red, green, blue]: Rgb): string => `\u001B[38;2;${red};${green};${blue}m`;

describe("parseStatusLineInput", () => {
  describe("公式 docs の JSON 例を受けたとき", () => {
    test("表示に使う項目をすべて取り出す", () => {
      expect(parseStatusLineInput(docsExample)).toEqual({
        model: "Opus",
        contextPercentage: 8,
        fiveHour: { usedPercentage: 23.5, resetsAt: 1738425600 },
        sevenDay: { usedPercentage: 41.2, resetsAt: 1738857600 },
        worktree: "feature-xyz",
        pr: {
          number: 1234,
          url: "https://github.com/anthropics/claude-code/pull/1234",
          reviewState: "pending",
        },
        cwd: "/current/working/directory",
      });
    });
  });

  describe("rate_limits・pr・git_worktree が無く、used_percentage が null のとき", () => {
    test("欠けた項目は undefined になる", () => {
      const input = parseStatusLineInput({
        model: { display_name: "Opus" },
        workspace: { current_dir: "/repo" },
        context_window: { used_percentage: null },
      });
      expect(input).toEqual({ model: "Opus", cwd: "/repo" });
      expect(input.fiveHour).toBeUndefined();
      expect(input.pr).toBeUndefined();
    });
  });

  describe("型の合わない値を受けたとき", () => {
    test("その項目だけを欠けた扱いにする", () => {
      expect(
        parseStatusLineInput({
          model: { display_name: 42 },
          rate_limits: { five_hour: { used_percentage: "23" }, seven_day: { used_percentage: 5 } },
          pr: { number: "1" },
        }),
      ).toEqual({ sevenDay: { usedPercentage: 5 } });
    });
  });

  describe("オブジェクトでない値を受けたとき", () => {
    test("何も取り出さない", () => {
      expect(parseStatusLineInput([1, 2])).toEqual({});
    });
  });
});

describe("renderStatusLine", () => {
  const full: StatusLineState = {
    model: "Opus",
    contextPercentage: 8,
    fiveHour: { usedPercentage: 23.5, resetsAt: 1738425600 },
    sevenDay: { usedPercentage: 41.2, resetsAt: 1738857600 },
    branch: "feat/statusline",
    worktree: "feat-statusline",
    pr: { number: 1234, url: "https://example.com/pull/1234", reviewState: "pending" },
  };

  describe("全項目が揃っていて無色のとき", () => {
    test("モデル・ctx・5h・7d・ブランチ・worktree・PR を 1 行に並べる", () => {
      expect(renderStatusLine(full, plain)).toBe(
        "Opus │ ctx ⣦        8% │ 5h ⣿⣷       24% 3h05m │ 7d ⣿⣿⣿⣄     41% 5d3h" +
          " │ ⎇ feat/statusline │ wt feat-statusline │ PR #1234 pending",
      );
    });
  });

  describe("rate_limits・worktree・PR が無いとき", () => {
    test("その区画を区切り文字ごと省く", () => {
      const { fiveHour: _f, sevenDay: _s, worktree: _w, pr: _p, ...rest } = full;
      expect(renderStatusLine(rest, plain)).toBe("Opus │ ctx ⣦        8% │ ⎇ feat/statusline");
    });
  });

  describe("PR に review_state が無いとき", () => {
    test("番号だけを出す", () => {
      expect(renderStatusLine({ pr: { number: 7 } }, plain)).toBe("PR #7");
    });
  });

  describe("何も情報が無いとき", () => {
    test("空文字列を返す", () => {
      expect(renderStatusLine({}, plain)).toBe("");
    });
  });

  describe("COLUMNS が 1 行分に足りないとき", () => {
    test("区画の切れ目で折り返し、各行を幅に収める", () => {
      const lines = renderStatusLine(full, { ...plain, columns: 60 }).split("\n");
      expect(lines).toEqual([
        "Opus │ ctx ⣦        8% │ 5h ⣿⣷       24% 3h05m",
        "7d ⣿⣿⣿⣄     41% 5d3h │ ⎇ feat/statusline",
        "wt feat-statusline │ PR #1234 pending",
      ]);
      for (const line of lines) {
        expect(Bun.stringWidth(line)).toBeLessThanOrEqual(60);
      }
    });
  });

  describe("色付きのとき", () => {
    const barColorOf = (percentage: number): string =>
      renderStatusLine({ contextPercentage: percentage }, { ...plain, colors });

    test.each([
      [0, "MINT"],
      [50, "ORANGE"],
      [80, "RED"],
      [100, "RED"],
    ])("使用率 %d%% のバーは palette.sh の %s で塗る", (percentage, name) => {
      expect(barColorOf(percentage)).toInclude(`${escapeOf(color(name))}${brailleBar(percentage)}`);
    });

    test("中間の使用率は隣の 2 色の間の色になる", () => {
      expect(barColorOf(25)).not.toInclude(escapeOf(colors.mint));
      expect(barColorOf(25)).not.toInclude(escapeOf(colors.orange));
    });

    test("PR 番号を OSC 8 で PR の URL へリンクする", () => {
      expect(renderStatusLine({ pr: full.pr }, { ...plain, colors })).toInclude(
        "\u001B]8;;https://example.com/pull/1234\u0007#1234\u001B]8;;\u0007",
      );
    });

    test("ANSI を除いた表示幅は無色のときと同じ", () => {
      expect(Bun.stringWidth(renderStatusLine(full, { ...plain, colors }))).toBe(
        Bun.stringWidth(renderStatusLine(full, plain)),
      );
    });
  });
});

describe("brailleBar", () => {
  test.each([
    [0, "        "],
    [50, "⣿⣿⣿⣿    "],
    [100, "⣿⣿⣿⣿⣿⣿⣿⣿"],
    [150, "⣿⣿⣿⣿⣿⣿⣿⣿"],
  ])("使用率 %d%% は 8 文字の %p になる", (percentage, bar) => {
    expect(brailleBar(percentage)).toBe(bar);
  });
});

describe("formatTimeUntil", () => {
  test.each([
    [2 * 86_400 + 8 * 3600 + 59, "2d8h"],
    [3 * 3600 + 5 * 60, "3h05m"],
    [45 * 60 + 30, "45m"],
    [-10, "0m"],
  ])("残り %d 秒は %s と書く", (seconds, expected) => {
    expect(formatTimeUntil(1000 + seconds, 1000)).toBe(expected);
  });
});

describe("statusline.ts の実行", () => {
  let home = "";
  let repo = "";

  const run = (stdin: string, env: Record<string, string> = {}) => {
    const result = Bun.spawnSync([process.execPath, scriptPath], {
      env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", NO_COLOR: "1", ...env },
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { stdout: result.stdout.toString(), exitCode: result.exitCode };
  };

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "statusline-home-"));
    repo = mkdtempSync(join(tmpdir(), "statusline-repo-"));
    Bun.spawnSync(["git", "init", "-q", "-b", "topic", repo]);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  describe("stdin が JSON でないとき", () => {
    test.each(["{broken", "", "42"])("%p でも 0 で終わり、1 行の説明を出す", (stdin) => {
      const { stdout, exitCode } = run(stdin);
      expect(exitCode).toBe(0);
      expect(stdout).toBe("statusline: stdin が JSON オブジェクトでない\n");
    });
  });

  describe("git リポジトリ内の cwd を受けたとき", () => {
    test("現在ブランチの区画を出す", () => {
      const { stdout, exitCode } = run(
        JSON.stringify({ model: { display_name: "Opus" }, workspace: { current_dir: repo } }),
      );
      expect(exitCode).toBe(0);
      expect(stdout).toBe("Opus │ ⎇ topic\n");
    });
  });

  describe("cwd が存在しないとき", () => {
    test("ブランチの区画を省く", () => {
      const { stdout } = run(
        JSON.stringify({ ...docsExample, pr: undefined, rate_limits: undefined }),
      );
      expect(stdout).toBe("Opus │ ctx ⣦        8% │ wt feature-xyz\n");
    });
  });

  describe("NO_COLOR が無いとき", () => {
    test("palette.sh の色で塗る", () => {
      const { stdout } = run(JSON.stringify({ context_window: { used_percentage: 0 } }), {
        NO_COLOR: "",
      });
      expect(stdout).toInclude(escapeOf(colors.mint));
    });
  });

  describe("COLUMNS が狭いとき", () => {
    test("複数行に折り返す", () => {
      const { stdout } = run(JSON.stringify(docsExample), { COLUMNS: "40" });
      expect(stdout.trimEnd().split("\n").length).toBeGreaterThan(1);
    });
  });
});

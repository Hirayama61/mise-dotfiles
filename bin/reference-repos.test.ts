import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSettings,
  expectedSettings,
  referencePaths,
  resolveGhqRoot,
  settingsPath,
} from "./reference-repos.ts";

const scriptPath = join(import.meta.dir, "reference-repos.ts");

describe("referencePaths", () => {
  describe("[bootstrap.repos] に ~/ghq/ 配下のキーが並ぶとき", () => {
    test("キーを ~ のまま宣言順に返す", () => {
      const miseToml = {
        bootstrap: {
          repos: {
            "~/ghq/github.com/jdx/mise": { url: "https://github.com/jdx/mise.git" },
            "~/ghq/github.com/oven-sh/bun": { url: "https://github.com/oven-sh/bun.git" },
          },
        },
      };
      expect(referencePaths(miseToml)).toEqual([
        "~/ghq/github.com/jdx/mise",
        "~/ghq/github.com/oven-sh/bun",
      ]);
    });
  });

  describe("[bootstrap.repos] が無いとき", () => {
    test("空の一覧を返す", () => {
      expect(referencePaths({ tools: {} })).toEqual([]);
    });
  });

  describe("~/ghq/ の外を指すキーがあるとき", () => {
    test("そのキーを挙げて失敗する", () => {
      const miseToml = { bootstrap: { repos: { "/Users/me/src/mise": { url: "x" } } } };
      expect(() => referencePaths(miseToml)).toThrow("/Users/me/src/mise");
    });
  });
});

describe("buildSettings", () => {
  describe("参照リポのパスを受けたとき", () => {
    const settings = buildSettings(["~/ghq/github.com/jdx/mise"]);

    test("additionalDirectories にパスを ~ のまま並べる", () => {
      expect(settings.permissions.additionalDirectories).toEqual(["~/ghq/github.com/jdx/mise"]);
    });

    test("deny で配下の編集を拒否する", () => {
      expect(settings.permissions.deny).toEqual(["Edit(~/ghq/github.com/jdx/mise/**)"]);
    });
  });
});

describe("resolveGhqRoot", () => {
  describe("GHQ_ROOT も ghq.root も無いとき", () => {
    test("~/ghq を返す", () => {
      expect(resolveGhqRoot(undefined, null, "/home/me")).toBe("/home/me/ghq");
    });
  });

  describe("git config の ghq.root が ~ 始まりで複数あるとき", () => {
    test("先頭を ~ を展開して返す", () => {
      expect(resolveGhqRoot(undefined, "~/src\n~/ghq", "/home/me")).toBe("/home/me/src");
    });
  });

  describe("GHQ_ROOT と ghq.root の両方があるとき", () => {
    test("GHQ_ROOT を優先し、末尾の / を落とす", () => {
      expect(resolveGhqRoot("/work/repos/", "~/ghq", "/home/me")).toBe("/work/repos");
    });
  });
});

describe(".claude/settings.json", () => {
  describe("commit 済みのファイルを mise.toml の宣言と突き合わせたとき", () => {
    test("[bootstrap.repos] から生成した内容と一致する(ずれたら mise run refs:settings)", async () => {
      const committed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(committed).toEqual(await expectedSettings());
    });
  });
});

describe("reference-repos.ts sync", () => {
  let dir: string;
  let home: string;
  let miseLog: string;
  let gitConfig: string;

  const runSync = (extraEnv: Record<string, string>) =>
    Bun.spawnSync(["bun", scriptPath, "sync"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        GIT_CONFIG_GLOBAL: gitConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        MISE_BIN: join(dir, "fake-mise"),
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reference-repos-"));
    home = join(dir, "home");
    mkdirSync(home);
    miseLog = join(dir, "mise.log");
    gitConfig = join(dir, "gitconfig");
    writeFileSync(gitConfig, "");
    writeFileSync(join(dir, "fake-mise"), `#!/bin/sh\necho "$@" > "${miseLog}"\n`);
    chmodSync(join(dir, "fake-mise"), 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("ghq の root が既定の ~/ghq のとき", () => {
    test("mise bootstrap で repos だけを適用する", () => {
      const result = runSync({});
      expect(result.exitCode).toBe(0);
      expect(readFileSync(miseLog, "utf8").trim()).toBe("bootstrap --only repos --yes");
    });
  });

  describe("GHQ_ROOT が ~/ghq 以外を指すとき", () => {
    test("clone せずに食い違いを知らせて失敗する", () => {
      const result = runSync({ GHQ_ROOT: "/work/repos" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("/work/repos");
      expect(existsSync(miseLog)).toBe(false);
    });
  });
});

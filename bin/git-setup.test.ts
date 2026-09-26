import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseToolVersion } from "./git-setup.ts";

const scriptPath = join(import.meta.dir, "git-setup.ts");

const writeExecutable = (path: string, body: string): void => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

// 認証・GitHub API・導入コマンドを env で切り替える偽 gh。
const fakeGhScript = `
if [ "$1" = "--version" ]; then echo "gh version 2.62.0 (2026-01-01)"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then [ "$FAKE_GH_AUTHENTICATED" = "1" ]; exit $?; fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then touch "$FAKE_MARKER_DIR/gh-login"; exit 0; fi
if [ "$1" = "api" ]; then
  case "$4" in
    ".login") echo "octocat" ;;
    ".id") echo "583231" ;;
    ".name // .login") echo "The Octocat" ;;
  esac
  exit 0
fi
exit 1`;

// gh の導入だけを引き受ける偽 mise。導入後の場所は which で答える。
const fakeMiseScript = `
if [ "$1" = "use" ]; then touch "$FAKE_MARKER_DIR/mise-use"; exit 0; fi
if [ "$1" = "which" ] && [ "$2" = "gh" ]; then echo "$FAKE_GH_PATH"; exit 0; fi
exit 1`;

type Scenario = {
  ghOnPath?: boolean;
  ghAuthenticated?: boolean;
  gitconfig?: string;
  input?: string;
};

type RunResult = {
  stdout: string;
  exitCode: number | null;
  configPath: string;
  hasMarker: (name: string) => boolean;
};

// git-setup.ts を、外部効果を一時ディレクトリへ逸らした子プロセスとして実行する。
// git は本物を使い、書き先は GIT_CONFIG_GLOBAL で隔離する。
const runGitSetup = ({
  ghOnPath = true,
  ghAuthenticated = true,
  gitconfig,
  input = "",
}: Scenario): RunResult => {
  const home = mkdtempSync(join(tmpdir(), "git-setup-test-"));
  const fakebin = join(home, "fakebin");
  const systembin = join(home, "systembin");
  const outside = join(home, "outside-path");
  const markerDir = join(home, "markers");
  for (const dir of [fakebin, systembin, outside, markerDir]) {
    mkdirSync(dir);
  }

  // CI の runner には本物の gh が居る。PATH を偽コマンドと、テストが要る
  // 実コマンドの symlink だけに閉じ、ホストの gh を拾わないようにする。
  for (const tool of ["git", "touch", "cat"]) {
    const realPath = Bun.which(tool);
    if (realPath === null) {
      throw new Error(`テストに必要な ${tool} が見つからない`);
    }
    symlinkSync(realPath, join(systembin, tool));
  }

  const ghPath = join(ghOnPath ? fakebin : outside, "gh");
  writeExecutable(ghPath, fakeGhScript);
  writeExecutable(join(fakebin, "mise"), fakeMiseScript);
  // 実行者のクリップボードを本物の pbcopy で汚さない。
  writeExecutable(join(fakebin, "pbcopy"), "cat > /dev/null");

  const configPath = join(home, "gitconfig");
  if (gitconfig !== undefined) {
    writeFileSync(configPath, gitconfig);
  }

  const result = Bun.spawnSync([process.execPath, scriptPath], {
    cwd: home,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: `${fakebin}:${systembin}`,
      HOME: home,
      GIT_CONFIG_GLOBAL: configPath,
      GIT_CONFIG_NOSYSTEM: "1",
      MISE_BIN: join(fakebin, "mise"),
      FAKE_GH_AUTHENTICATED: ghAuthenticated ? "1" : "0",
      FAKE_GH_PATH: ghPath,
      FAKE_MARKER_DIR: markerDir,
    },
  });

  return {
    stdout: result.stdout.toString(),
    exitCode: result.exitCode,
    configPath,
    hasMarker: (name: string) => existsSync(join(markerDir, name)),
  };
};

const completedGitconfig = "[user]\n\tname = octocat\n\temail = octocat@example.com\n";

describe("parseToolVersion", () => {
  describe("`gh version 2.62.0 (2026-01-01)` 形式の出力を受けたとき", () => {
    test("バージョン文字列だけを返す", () => {
      expect(parseToolVersion("gh version 2.62.0 (2026-01-01)")).toBe("2.62.0");
    });
  });

  describe("出力を取得できなかったとき", () => {
    test("空文字を返す", () => {
      expect(parseToolVersion(null)).toBe("");
    });
  });

  describe("バージョンの位置に語が無い出力を受けたとき", () => {
    test("空文字を返す", () => {
      expect(parseToolVersion("gh")).toBe("");
    });
  });
});

describe("globalGitConfigPath", () => {
  // Bun は homedir() を起動時に固定するため、HOME の差し替えは子プロセスで行う。
  const pathInChild = (env: Record<string, string>): string => {
    const script = `import { globalGitConfigPath } from ${JSON.stringify(scriptPath)}; console.log(globalGitConfigPath());`;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    return result.stdout.toString().trim();
  };

  describe("GIT_CONFIG_GLOBAL が設定されているとき", () => {
    test("他のファイルの有無に関わらずその値を返す", () => {
      const home = mkdtempSync(join(tmpdir(), "git-config-path-"));
      writeFileSync(join(home, ".gitconfig"), "");

      const override = join(home, "override-config");
      expect(pathInChild({ HOME: home, GIT_CONFIG_GLOBAL: override })).toBe(override);
    });
  });

  describe("~/.gitconfig があるとき", () => {
    test("~/.gitconfig を返す", () => {
      const home = mkdtempSync(join(tmpdir(), "git-config-path-"));
      writeFileSync(join(home, ".gitconfig"), "");

      expect(pathInChild({ HOME: home })).toBe(join(home, ".gitconfig"));
    });
  });

  describe("~/.gitconfig が無く XDG 側の config があるとき", () => {
    test("XDG 側のパスを返す", () => {
      const home = mkdtempSync(join(tmpdir(), "git-config-path-"));
      const xdgConfig = join(home, "xdg", "git");
      mkdirSync(xdgConfig, { recursive: true });
      writeFileSync(join(xdgConfig, "config"), "");

      expect(pathInChild({ HOME: home, XDG_CONFIG_HOME: join(home, "xdg") })).toBe(
        join(xdgConfig, "config"),
      );
    });
  });

  describe("どちらのファイルも無いとき", () => {
    test("~/.gitconfig を返す", () => {
      const home = mkdtempSync(join(tmpdir(), "git-config-path-"));

      expect(pathInChild({ HOME: home })).toBe(join(home, ".gitconfig"));
    });
  });
});

describe("git-setup.ts", () => {
  describe("gh が PATH に無いとき", () => {
    test("mise で導入し、mise which の場所の gh で続行する", () => {
      const run = runGitSetup({ ghOnPath: false, gitconfig: completedGitconfig });

      expect(run.exitCode).toBe(0);
      expect(run.hasMarker("mise-use")).toBe(true);
      expect(run.stdout).toInclude("2.62.0");
    });
  });

  describe("gh 導入済み・認証済み・identity 設定済みのとき", () => {
    test("何も変更せず既存の値を kept で表示する", () => {
      const run = runGitSetup({ gitconfig: completedGitconfig });

      expect(run.exitCode).toBe(0);
      expect(run.hasMarker("mise-use")).toBe(false);
      expect(run.hasMarker("gh-login")).toBe(false);
      expect(run.stdout).toInclude("既に設定済みなので変更しません");
      expect(readFileSync(run.configPath, "utf8")).toBe(completedGitconfig);
    });
  });

  describe("gh が未認証のとき", () => {
    test("gh auth login を実行してから続行する", () => {
      const run = runGitSetup({ ghAuthenticated: false, gitconfig: completedGitconfig });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toInclude("GitHub の認証が必要です");
      expect(run.hasMarker("gh-login")).toBe(true);
    });
  });

  describe("identity が未設定で、既定値のまま書き込みに答えたとき", () => {
    test("GitHub アカウント由来の name と noreply の email を書き込む", () => {
      const run = runGitSetup({ input: "\n\n\n" });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toInclude("~/gitconfig に書きます");
      const written = readFileSync(run.configPath, "utf8");
      expect(written).toInclude("name = The Octocat");
      expect(written).toInclude("email = 583231+octocat@users.noreply.github.com");
    });
  });

  describe("identity の書き込みを確認で断ったとき", () => {
    test("何も書き込まず中止を案内する", () => {
      const run = runGitSetup({ input: "\n\nn\n" });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toInclude("中止しました");
      expect(existsSync(run.configPath)).toBe(false);
    });
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hookPath = join(import.meta.dir, "block-main-clone-edit.ts");

// 実行者の ~/ を読み書きしないよう、HOME と git の global 設定を一時ディレクトリへ逸らす。
let home = "";
let mainClone = "";
let linkedWorktree = "";
let outsideRepo = "";

const gitEnv = (): Record<string, string> => ({
  HOME: home,
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

const runGit = (cwd: string, args: string[]): void => {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: gitEnv(),
    stdout: "ignore",
    stderr: "pipe",
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
};

const runHook = (
  input: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; exitCode: number | null } => {
  const result = Bun.spawnSync([process.execPath, hookPath], {
    env: { ...gitEnv(), ...extraEnv },
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
};

const editInput = (filePath: string): string =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  });

const decisionOf = (stdout: string): string | undefined =>
  (JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string } })
    .hookSpecificOutput?.permissionDecision;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "block-main-clone-"));
  writeFileSync(join(home, "gitconfig"), "");

  mainClone = join(home, "ghq", "github.com", "owner", "repo");
  mkdirSync(mainClone, { recursive: true });
  runGit(mainClone, ["init", "-q", "-b", "main"]);
  writeFileSync(join(mainClone, "README.md"), "");
  runGit(mainClone, ["add", "README.md"]);
  runGit(mainClone, ["commit", "-q", "-m", "chore: init"]);

  linkedWorktree = join(home, "worktrees", "github.com", "owner", "repo", "feat-x");
  mkdirSync(join(home, "worktrees", "github.com", "owner", "repo"), { recursive: true });
  runGit(mainClone, ["worktree", "add", "-q", "-b", "feat-x", linkedWorktree]);

  outsideRepo = join(home, "notes");
  mkdirSync(outsideRepo, { recursive: true });
  runGit(outsideRepo, ["init", "-q", "-b", "main"]);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("block-main-clone-edit", () => {
  describe("~/ghq 配下の main clone 本体のファイルを編集しようとしたとき", () => {
    test("deny を返し、理由に実パスと EnterWorktree への案内を含める", () => {
      const { stdout, exitCode } = runHook(editInput(join(mainClone, "README.md")));

      expect(exitCode).toBe(0);
      expect(decisionOf(stdout)).toBe("deny");
      expect(stdout).toInclude(join(realpathSync(mainClone), "README.md"));
      expect(stdout).toInclude("EnterWorktree");
    });

    test("まだ無いファイルでも、親ディレクトリが main clone なら deny を返す", () => {
      const { stdout } = runHook(editInput(join(mainClone, "new-file.ts")));

      expect(decisionOf(stdout)).toBe("deny");
    });

    test("GIT_DIR が linked worktree を指していても deny を返す", () => {
      const { stdout } = runHook(editInput(join(mainClone, "README.md")), {
        GIT_DIR: join(mainClone, ".git", "worktrees", "feat-x"),
      });

      expect(decisionOf(stdout)).toBe("deny");
    });
  });

  describe("linked worktree のファイルを編集しようとしたとき", () => {
    test("何も出力せず通す", () => {
      const { stdout, exitCode } = runHook(editInput(join(linkedWorktree, "README.md")));

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    });
  });

  describe("~/ghq の外にある git 管理のファイルを編集しようとしたとき", () => {
    test("何も出力せず通す", () => {
      const { stdout } = runHook(editInput(join(outsideRepo, "memo.md")));

      expect(stdout).toBe("");
    });
  });

  describe("判定できない入力のとき", () => {
    test("相対パスは通す", () => {
      expect(runHook(editInput("README.md")).stdout).toBe("");
    });

    test("親ディレクトリが存在しないパスは通す", () => {
      expect(runHook(editInput(join(mainClone, "missing", "file.ts"))).stdout).toBe("");
    });

    test("file_path が無い入力は通す", () => {
      expect(runHook(JSON.stringify({ tool_name: "Edit", tool_input: {} })).stdout).toBe("");
    });

    test("壊れた JSON は exit 0 で通す", () => {
      const { stdout, exitCode } = runHook("{not json");

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    });
  });
});

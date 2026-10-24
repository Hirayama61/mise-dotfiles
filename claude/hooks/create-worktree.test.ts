import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hookPath = join(import.meta.dir, "create-worktree.ts");

// gwq の本物は ~/worktrees へ書くので、同じ引数を受けて一時ディレクトリへ worktree を作る偽物に差し替える。
const fakeGwqScript = `#!/bin/sh
printf '%s\\n' "$*" >> "$GWQ_LOG"
if [ -n "$GWQ_FAIL" ]; then echo "gwq: 失敗の再現" >&2; exit 1; fi
if [ "$2" = "-b" ]; then
  git worktree add -q -b "$3" "$GWQ_BASE/$3"
else
  git worktree add -q "$GWQ_BASE/$2" "$2"
fi
echo "Created worktree for branch"
`;

let home = "";
let repo = "";
let worktreeBase = "";
let gwqLog = "";

const env = (extra: Record<string, string> = {}): Record<string, string> => ({
  HOME: home,
  PATH: `${join(home, "bin")}:/usr/bin:/bin`,
  GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GWQ_BASE: worktreeBase,
  GWQ_LOG: gwqLog,
  ...extra,
});

const runGit = (cwd: string, args: string[]): void => {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: env(),
    stdout: "ignore",
    stderr: "pipe",
  });
  if (!result.success) {
    throw new Error(result.stderr.toString());
  }
};

const runHook = (
  input: string,
  extra: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number | null } => {
  const result = Bun.spawnSync([process.execPath, hookPath], {
    env: env(extra),
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const createInput = (name: string): string =>
  JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: repo, name });

const gwqCalls = (): string[] =>
  existsSync(gwqLog)
    ? readFileSync(gwqLog, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "create-worktree-"));
  writeFileSync(join(home, "gitconfig"), "");

  mkdirSync(join(home, "bin"));
  const fakeGwq = join(home, "bin", "gwq");
  writeFileSync(fakeGwq, fakeGwqScript);
  chmodSync(fakeGwq, 0o755);

  repo = join(home, "ghq", "github.com", "owner", "repo");
  mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "README.md"), "");
  runGit(repo, ["add", "README.md"]);
  runGit(repo, ["commit", "-q", "-m", "chore: init"]);

  worktreeBase = join(home, "worktrees");
  mkdirSync(worktreeBase);
  gwqLog = join(home, "gwq.log");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("create-worktree", () => {
  describe("まだ無いブランチ名を受けたとき", () => {
    test("gwq add -b で worktree を作り、その実パスだけを stdout に出す", () => {
      const { stdout, exitCode } = runHook(createInput("feat-new"));

      expect(exitCode).toBe(0);
      expect(stdout.trim().split("\n")).toEqual([realpathSync(join(worktreeBase, "feat-new"))]);
      expect(gwqCalls()).toEqual(["add -b feat-new"]);
    });

    test("gwq の表示は stdout に混ぜない", () => {
      const { stdout, stderr } = runHook(createInput("feat-new"));

      expect(stdout).not.toInclude("Created worktree");
      expect(stderr).toInclude("Created worktree");
    });
  });

  describe("既にあるブランチ名を受けたとき", () => {
    test("新しいブランチを切らずに gwq add で checkout する", () => {
      runGit(repo, ["branch", "feat-existing"]);

      const { stdout, exitCode } = runHook(createInput("feat-existing"));

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(realpathSync(join(worktreeBase, "feat-existing")));
      expect(gwqCalls()).toEqual(["add feat-existing"]);
    });
  });

  describe("そのブランチの worktree が既にあるとき", () => {
    test("gwq を呼ばずに既存の worktree のパスを返す", () => {
      const existing = join(worktreeBase, "feat-reuse");
      runGit(repo, ["worktree", "add", "-q", "-b", "feat-reuse", existing]);

      const { stdout, exitCode } = runHook(createInput("feat-reuse"));

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(realpathSync(existing));
      expect(gwqCalls()).toEqual([]);
    });
  });

  describe("gwq が失敗したとき", () => {
    test("非ゼロで終わり、stdout にパスを出さない", () => {
      const { stdout, stderr, exitCode } = runHook(createInput("feat-fail"), { GWQ_FAIL: "1" });

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toInclude("gwq add が失敗した");
    });
  });

  describe("name が無い入力のとき", () => {
    test("非ゼロで終わる", () => {
      const { exitCode, stderr } = runHook(JSON.stringify({ cwd: repo }));

      expect(exitCode).toBe(1);
      expect(stderr).toInclude("name");
    });
  });
});

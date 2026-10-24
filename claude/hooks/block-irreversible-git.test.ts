import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hookPath = join(import.meta.dir, "block-irreversible-git.ts");

// 実行者の ~/ を読み書きしないよう、HOME と git の global 設定を一時ディレクトリへ逸らす。
let home = "";
let mainClone = "";
let pushedWorktree = "";
let featureWorktree = "";
let outsideGit = "";

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

const runHook = (input: string): { stdout: string; exitCode: number | null } => {
  const result = Bun.spawnSync([process.execPath, hookPath], {
    env: gitEnv(),
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
};

const bashInput = (command: string, cwd: string): string =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    cwd,
  });

const reasonOf = (stdout: string): string | undefined =>
  (
    JSON.parse(stdout) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    }
  ).hookSpecificOutput?.permissionDecisionReason;

const expectDenied = (command: string, cwd: string, operation: string): void => {
  const { stdout, exitCode } = runHook(bashInput(command, cwd));
  expect(exitCode).toBe(0);
  expect(stdout).toInclude('"permissionDecision":"deny"');
  expect(reasonOf(stdout)).toInclude(operation);
};

const expectAllowed = (command: string, cwd: string): void => {
  const { stdout, exitCode } = runHook(bashInput(command, cwd));
  expect(exitCode).toBe(0);
  expect(stdout).toBe("");
};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "block-irreversible-git-"));
  writeFileSync(join(home, "gitconfig"), "");

  const remote = join(home, "remote.git");
  runGit(home, ["init", "-q", "--bare", "-b", "main", remote]);

  mainClone = join(home, "repo");
  mkdirSync(mainClone);
  runGit(mainClone, ["init", "-q", "-b", "main"]);
  writeFileSync(join(mainClone, "README.md"), "");
  runGit(mainClone, ["add", "README.md"]);
  runGit(mainClone, ["commit", "-q", "-m", "chore: init"]);
  runGit(mainClone, ["remote", "add", "origin", remote]);
  runGit(mainClone, ["push", "-q", "origin", "main"]);

  // HEAD が origin/main と同じコミットを指す、push 済みの feature ブランチ。
  pushedWorktree = join(home, "pushed");
  runGit(mainClone, ["worktree", "add", "-q", "-b", "feat-pushed", pushedWorktree]);

  // push していないコミットを HEAD に持つ feature ブランチ。
  featureWorktree = join(home, "feature");
  runGit(mainClone, ["worktree", "add", "-q", "-b", "feat-x", featureWorktree]);
  runGit(featureWorktree, ["commit", "-q", "--allow-empty", "-m", "feat: local"]);

  outsideGit = join(home, "plain");
  mkdirSync(outsideGit);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("block-irreversible-git", () => {
  describe("git push の force 系オプションのとき", () => {
    test.each([
      "git push --force",
      "git push --force-with-lease=main:abc origin main",
      "git push --force-if-includes",
      "git push -uf origin feat-x",
      "git push origin feat-x -f",
      `git push "--force"`,
      "FOO=1 timeout 30 git push --force",
      "git -C . push --force",
    ])("%s を deny し、理由に hook 名と ! での実行案内を含める", (command) => {
      const { stdout } = runHook(bashInput(command, featureWorktree));

      expect(reasonOf(stdout)).toInclude("[block-irreversible-git]");
      expect(reasonOf(stdout)).toInclude("git push --force");
      expect(reasonOf(stdout)).toInclude("! に続けて");
    });
  });

  describe("保護ブランチで push / merge するとき", () => {
    test("main での git push を deny する", () => {
      expectDenied("git push origin main", mainClone, "保護ブランチ main");
    });

    test("main での git merge を deny する", () => {
      expectDenied("git merge feat-x", mainClone, "保護ブランチ main");
    });

    test("cd 先が main の worktree なら、セッションの cwd が feature でも deny する", () => {
      expectDenied(`cd ${mainClone} && git push`, featureWorktree, "保護ブランチ main");
    });

    test("git -C の先が main なら deny する", () => {
      expectDenied(`git -C ${mainClone} merge feat-x`, featureWorktree, "保護ブランチ main");
    });

    test("存在しない dir への cd の後も、元の main で判定して deny する", () => {
      expectDenied(`cd ${join(home, "missing")} || git push`, mainClone, "保護ブランチ main");
    });

    test("サブシェル内の cd は外へ漏らさず、後続の push を main で判定して deny する", () => {
      expectDenied(`(cd ${featureWorktree} && pwd); git push`, mainClone, "保護ブランチ main");
    });

    test("先に main へ switch した後の merge は deny する", () => {
      expectDenied("git switch main && git merge feat-x", featureWorktree, "保護ブランチ main");
    });

    test("main から feature ブランチを作って切り替えた後の push は通す", () => {
      expectAllowed("git switch -c feat/new && git push -u origin feat/new", mainClone);
      expectAllowed("git checkout -b feat/new2 && git push", mainClone);
    });

    test("main での git merge --abort は通す", () => {
      expectAllowed("git merge --abort", mainClone);
    });

    test("feature ブランチでの git push は通す", () => {
      expectAllowed("git push -u origin feat-x", featureWorktree);
    });
  });

  describe("未コミット作業を捨てる git 操作のとき", () => {
    test.each([
      ["git reset --hard HEAD~1", "git reset --hard"],
      ["git clean -fdx", "git clean -f"],
      ["git clean --force", "git clean -f"],
      ["git stash drop", "git stash drop"],
      ["git stash clear", "git stash clear"],
      ["git checkout -- README.md", "git checkout <path>"],
      ["git checkout HEAD -- README.md", "git checkout <path>"],
      ["git checkout .", "git checkout <path>"],
      ["git checkout -f main", "git checkout -f"],
      ["git switch --discard-changes main", "git switch --discard-changes"],
      ["git switch -f main", "git switch --discard-changes"],
      ["git restore README.md", "git restore"],
      ["git branch -D feat-x", "git branch -D"],
      ["git branch --delete --force feat-x", "git branch -D"],
      ["git worktree remove --force ../x", "git worktree remove --force"],
      ['echo "`git reset --hard`"', "git reset --hard"],
    ])("%s を deny する", (command, operation) => {
      expectDenied(command, featureWorktree, operation);
    });

    test.each([
      "git reset --soft HEAD~1",
      "git clean -nfd",
      "git stash push -m drop",
      "git stash list",
      "git checkout feat-x",
      "git checkout -b feat/y origin/main",
      "git switch -c feat/z",
      "git restore --staged README.md",
      "git branch -d feat-x",
      "git worktree remove ../x",
    ])("%s は通す", (command) => {
      expectAllowed(command, featureWorktree);
    });
  });

  describe("git commit --amend のとき", () => {
    test("HEAD が push 済みなら deny する", () => {
      expectDenied("git commit --amend --no-edit", pushedWorktree, "push 済みの HEAD");
    });

    test("HEAD が未 push なら通す", () => {
      expectAllowed("git commit --amend --no-edit", featureWorktree);
    });
  });

  describe("git commit --no-verify のとき", () => {
    test.each(["git commit --no-verify -m x", "git commit -nm x", "git commit -an -m x"])(
      "%s を deny する",
      (command) => {
        expectDenied(command, featureWorktree, "--no-verify");
      },
    );

    test("-m の値にある -n は no-verify とみなさない", () => {
      expectAllowed(`git commit -m "-n は no-verify の短縮"`, featureWorktree);
    });
  });

  describe("gh の外向き操作のとき", () => {
    test.each([
      "gh pr merge 12 --squash",
      "gh pr close 12",
      "gh pr ready",
      "gh -R owner/repo pr merge 12",
      "gh release create v1.0.0",
      "gh release delete v1.0.0",
      "gh release edit v1.0.0",
      "gh repo delete owner/repo",
      "gh repo archive",
      "gh repo edit --visibility public",
    ])("%s を deny する", (command) => {
      expectDenied(command, outsideGit, "gh ");
    });

    test.each(["gh pr view 12", "gh pr create --fill", "gh release list", "gh repo view"])(
      "%s は通す",
      (command) => {
        expectAllowed(command, outsideGit);
      },
    );
  });

  describe("誤検知しやすい形のとき", () => {
    test.each([
      "git log | grep push",
      "bash -n script.sh && git commit -m x",
      "grep -n foo README.md",
      `echo "git push -f"`,
      "git log --oneline -n 5",
      "git merge-base main feat-x",
      "cat <<'EOF' > memo.md\ngit reset --hard\ngh pr merge 1\nEOF",
      `git commit -m "$(cat <<'EOF'\nfix: "x" を直す\n\n\`git push --force\` は使わない\nEOF\n)"`,
    ])("%s は通す", (command) => {
      expectAllowed(command, featureWorktree);
    });
  });

  describe("判定できない入力のとき", () => {
    test("git 外での push は通す", () => {
      expectAllowed("git push", outsideGit);
    });

    test("存在しないディレクトリでの merge は通す", () => {
      expectAllowed("git merge x", join(home, "missing"));
    });

    test("Bash 以外のツールは通す", () => {
      const input = JSON.stringify({ tool_name: "Edit", tool_input: { command: "git push -f" } });
      expect(runHook(input).stdout).toBe("");
    });

    test("壊れた JSON は exit 0 で通す", () => {
      const { stdout, exitCode } = runHook("{not json");

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
    });
  });
});

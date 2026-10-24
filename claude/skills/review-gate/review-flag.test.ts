import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(import.meta.dir, "review-flag.ts");

// 実行者の ~/ と ~/.local/state を読み書きしないよう、HOME・XDG_STATE_HOME・git の global 設定を逸らす。
let home = "";
let repo = "";

const testEnv = (): Record<string, string> => ({
  HOME: home,
  XDG_STATE_HOME: join(home, "state"),
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
});

const run = (cmd: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } => {
  const result = Bun.spawnSync(cmd, { cwd, env: testEnv(), stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const runGit = (cwd: string, args: string[]): void => {
  if (run(["git", ...args], cwd).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} が失敗した`);
  }
};

const commitFile = (file: string, content: string): void => {
  writeFileSync(join(repo, file), content);
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-q", "-m", `change ${file}`]);
};

type Status = { pushable_diff: boolean; fingerprint?: string; approved?: boolean };

const status = (): Status =>
  JSON.parse(run([process.execPath, cliPath, "status"], repo).stdout) as Status;

const approve = (fingerprint: string): { stderr: string; exitCode: number } =>
  run(
    [
      process.execPath,
      cliPath,
      "approve",
      "--fingerprint",
      fingerprint,
      "--engine",
      "code-review",
      "--effort",
      "low",
    ],
    repo,
  );

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "review-flag-"));
  writeFileSync(join(home, "gitconfig"), "");
  const remote = join(home, "remote.git");
  const seed = join(home, "seed");
  runGit(home, ["init", "-q", "--bare", "-b", "main", remote]);
  runGit(home, ["clone", "-q", remote, seed]);
  writeFileSync(join(seed, "README.md"), "seed\n");
  runGit(seed, ["add", "."]);
  runGit(seed, ["commit", "-q", "-m", "seed"]);
  runGit(seed, ["push", "-q", "origin", "HEAD:main"]);

  repo = join(home, "repo");
  runGit(home, ["clone", "-q", remote, repo]);
  runGit(repo, ["switch", "-q", "-c", "feat/x"]);
  mkdirSync(join(repo, "src"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("review-flag.ts", () => {
  test("送るコミットが無ければ status は pushable_diff: false を返す", () => {
    expect(status()).toEqual({ pushable_diff: false });
  });

  test("approve した差分は status で approved: true になり、flag をリポジトリ外に書く", () => {
    commitFile("src/app.ts", "export const a = 1;\n");
    const { fingerprint } = status();
    expect(approve(fingerprint ?? "").exitCode).toBe(0);
    expect(status().approved).toBe(true);
    expect(readdirSync(join(home, "state", "claude-review-gate"))).toEqual([
      expect.stringMatching(/^repo-[0-9a-f]{12}$/),
    ]);
  });

  test("レビュー後に差分が変わると approve は失敗し flag を書かない", () => {
    const { fingerprint } = status();
    commitFile("src/app.ts", "export const a = 2;\n");
    const result = approve(fingerprint ?? "");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toInclude("レビュー後に差分が変わっている");
    expect(status().approved).toBe(false);
  });
});

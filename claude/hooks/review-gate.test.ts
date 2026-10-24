import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hookPath = join(import.meta.dir, "review-gate.ts");
const flagCliPath = join(import.meta.dir, "..", "skills", "review-gate", "review-flag.ts");

// 実行者の ~/ と ~/.local/state を読み書きしないよう、HOME・XDG_STATE_HOME・git の global 設定を逸らす。
let home = "";
let feature = "";
let outsideGit = "";

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

const run = (cmd: string[], cwd: string, stdin = ""): { stdout: string; exitCode: number } => {
  const result = Bun.spawnSync(cmd, {
    cwd,
    env: testEnv(),
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout.toString(), exitCode: result.exitCode };
};

const runGit = (cwd: string, args: string[]): void => {
  if (run(["git", ...args], cwd).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} が失敗した`);
  }
};

const commitFile = (cwd: string, file: string, content: string): void => {
  mkdirSync(join(cwd, file, ".."), { recursive: true });
  writeFileSync(join(cwd, file), content);
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-q", "-m", `change ${file}`]);
};

const runHook = (command: string, cwd: string): string =>
  run(
    [process.execPath, hookPath],
    cwd,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
      cwd,
    }),
  ).stdout;

const reasonOf = (stdout: string): string =>
  (JSON.parse(stdout) as { hookSpecificOutput: { permissionDecisionReason: string } })
    .hookSpecificOutput.permissionDecisionReason;

const fingerprintOf = (cwd: string): string =>
  (
    JSON.parse(run([process.execPath, flagCliPath, "status"], cwd).stdout) as {
      fingerprint: string;
    }
  ).fingerprint;

const approve = (cwd: string): void => {
  const fingerprint = fingerprintOf(cwd);
  const args = [
    "approve",
    "--fingerprint",
    fingerprint,
    "--engine",
    "code-review",
    "--effort",
    "low",
  ];
  if (run([process.execPath, flagCliPath, ...args], cwd).exitCode !== 0) {
    throw new Error("flag を発行できなかった");
  }
};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "review-gate-"));
  writeFileSync(join(home, "gitconfig"), "");
  outsideGit = join(home, "outside");
  mkdirSync(outsideGit);

  const remote = join(home, "remote.git");
  const seed = join(home, "seed");
  runGit(home, ["init", "-q", "--bare", "-b", "main", remote]);
  runGit(home, ["clone", "-q", remote, seed]);
  commitFile(seed, "README.md", "seed\n");
  runGit(seed, ["push", "-q", "origin", "HEAD:main"]);

  feature = join(home, "feature");
  runGit(home, ["clone", "-q", remote, feature]);
  runGit(feature, ["switch", "-q", "-c", "feat/x"]);
  commitFile(feature, "src/app.ts", "export const a = 1;\n");
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("review-gate hook: flag の無い差分の push", () => {
  test("git push を拒否し、低 risk なら /code-review low を案内する", () => {
    const reason = reasonOf(runHook("git push -u origin feat/x", feature));
    expect(reason).toStartWith("[review-gate]");
    expect(reason).toInclude("risk: LOW");
    expect(reason).toMatch(/\/code-review low [0-9a-f]{12}\.\.HEAD/);
  });

  test("cd で入ったリポジトリの push も拒否する", () => {
    expect(runHook(`cd ${feature} && git push`, outsideGit)).toInclude(
      '"permissionDecision":"deny"',
    );
  });

  test("git -C で指したリポジトリの push も拒否する", () => {
    expect(runHook(`git -C ${feature} push`, outsideGit)).toInclude('"permissionDecision":"deny"');
  });
});

describe("review-gate hook: 判定の対象外", () => {
  test.each([
    ["force push(block-irreversible-git が判定する)", "git push --force"],
    ["dry-run", "git push -n"],
    ["push を含まない git", "git log | grep push"],
    ["クォート内の push", 'echo "git push"'],
  ])("%s は止めない", (_, command) => {
    expect(runHook(command, feature)).toBe("");
  });

  test("git 外の push は止めない", () => {
    expect(runHook("git push", outsideGit)).toBe("");
  });

  test("JSON が壊れた入力は止めない", () => {
    expect(run([process.execPath, hookPath], feature, "{").stdout).toBe("");
  });

  test("送るコミットが無い push は止めない", () => {
    const clean = join(home, "clean");
    runGit(home, ["clone", "-q", join(home, "remote.git"), clean]);
    runGit(clean, ["switch", "-q", "-c", "feat/empty"]);
    expect(runHook("git push", clean)).toBe("");
  });
});

describe("review-gate hook: flag の発行と失効", () => {
  test("flag を発行した差分の push は通し、差分が変わると再び拒否する", () => {
    const repo = join(home, "approved");
    runGit(home, ["clone", "-q", join(home, "remote.git"), repo]);
    runGit(repo, ["switch", "-q", "-c", "feat/approved"]);
    commitFile(repo, "src/app.ts", "export const a = 1;\n");

    approve(repo);
    expect(runHook("git push -u origin feat/approved", repo)).toBe("");

    commitFile(repo, "src/app.ts", "export const a = 2;\n");
    expect(runHook("git push -u origin feat/approved", repo)).toInclude(
      '"permissionDecision":"deny"',
    );
  });

  test("認証のパスを含む差分は HIGH と判定し /code-review high を案内する", () => {
    const repo = join(home, "auth");
    runGit(home, ["clone", "-q", join(home, "remote.git"), repo]);
    runGit(repo, ["switch", "-q", "-c", "feat/auth"]);
    commitFile(repo, "src/auth/session.ts", "export const s = 1;\n");

    const reason = reasonOf(runHook("git push", repo));
    expect(reason).toInclude("risk: HIGH(認証(high): src/auth/session.ts)");
    expect(reason).toMatch(/\/code-review high [0-9a-f]{12}\.\.HEAD/);
  });
});

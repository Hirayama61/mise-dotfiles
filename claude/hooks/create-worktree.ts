import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { git, worktreePathOfBranch } from "./lib/git.ts";
import { readHookInput } from "./lib/hook-input.ts";

// hook の PATH に mise のツールが載っていないことがある。
// gwq はグローバルの mise ツールなので、shim 経由なら任意の cwd から解決できる。
const gwqBin = (): string => Bun.which("gwq") ?? join(homedir(), ".local/share/mise/shims/gwq");

const branchExists = (cwd: string, branch: string): boolean =>
  git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== null;

/**
 * gwq で worktree を作る。ブランチが無ければ現在の HEAD から新しく切る。
 *
 * Claude Code は stdout の最終行を worktree のパスとして読むため、gwq の表示は stderr へ流す。
 *
 * @param cwd - リポジトリ内のディレクトリ。gwq はここからリポジトリを特定する。
 * @param branch - worktree に checkout するブランチ。
 * @returns gwq が成功したら true。
 */
const createWithGwq = (cwd: string, branch: string): boolean => {
  const args = branchExists(cwd, branch) ? ["add", branch] : ["add", "-b", branch];
  const result = Bun.spawnSync([gwqBin(), ...args], { cwd, stdout: "pipe", stderr: "inherit" });
  process.stderr.write(result.stdout);
  return result.success;
};

/**
 * WorktreeCreate hook。
 *
 * Claude Code の既定(リポジトリ内 .claude/worktrees/)を置き換え、gwq の規約の場所
 * (~/worktrees/<host>/<owner>/<repo>/<branch>)に worktree を作って、そのパスを stdout に返す。
 * ブランチ名には hook が受け取る name をそのまま使う。
 * 同じブランチの worktree が既にあればそれを返す。
 * 作れなかったときは非ゼロで終わり、既定配置へ黙って落とさない。
 */
const runCreateWorktree = async (): Promise<void> => {
  const input = await readHookInput();
  const name = input?.name;
  if (typeof name !== "string" || name === "") {
    throw new Error("stdin の JSON に name が無い");
  }
  const cwd = input?.cwd ?? process.cwd();

  const existing = worktreePathOfBranch(cwd, name);
  if (existing === null && !createWithGwq(cwd, name)) {
    throw new Error(`gwq add が失敗した: ${name}`);
  }

  const path = existing ?? worktreePathOfBranch(cwd, name);
  if (path === null) {
    throw new Error(`ブランチ ${name} を checkout した worktree が見つからない`);
  }

  console.log(realpathSync(path));
};

if (import.meta.main) {
  runCreateWorktree().catch((error: unknown) => {
    console.error(`create-worktree: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

import { realpathSync } from "node:fs";

const gitBin = Bun.which("git") ?? "/usr/bin/git";

// 混線したシェルから GIT_DIR 等が持ち込まれると、プライマリ作業ツリーの判定が狂い
// main clone の編集が linked worktree と誤判定されてすり抜ける。hook の git はこれらを見ない。
const gitEnvOverrides = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
];

const envWithoutGitOverrides = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of gitEnvOverrides) {
    delete env[name];
  }
  return env;
};

/**
 * git を実行して標準出力を返す。
 *
 * @param cwd - git を実行するディレクトリ。
 * @param args - git に渡す引数。
 * @returns trim した標準出力。失敗・git 不在は null。
 */
export const git = (cwd: string, args: readonly string[]): string | null => {
  try {
    const result = Bun.spawnSync([gitBin, "-C", cwd, ...args], {
      env: envWithoutGitOverrides(),
      stdout: "pipe",
      stderr: "ignore",
    });
    return result.success ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
};

/**
 * ディレクトリがプライマリ作業ツリー(main clone 本体)の中かを判定する。
 *
 * linked worktree は --git-dir(.git/worktrees/<name>)と --git-common-dir(.git)が一致しない。
 * 一致するのはプライマリ作業ツリーだけ。
 *
 * @param dir - 実在する絶対パス。
 * @returns プライマリ作業ツリーなら true。git 外・linked worktree・判定不能は false。
 */
export const isPrimaryWorktree = (dir: string): boolean => {
  if (git(dir, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return false;
  }
  const output = git(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
  const [gitDir, commonDir] = output?.split("\n") ?? [];
  if (!gitDir || !commonDir) {
    return false;
  }
  try {
    return realpathSync(gitDir) === realpathSync(commonDir);
  } catch {
    return false;
  }
};

/**
 * ブランチを checkout している worktree のパスを返す。
 *
 * gwq は配置先のパスをブランチ名から変換する(`/` を `-` にする等)ため、
 * テンプレートから予測せず git に聞く。
 *
 * @param cwd - リポジトリ内のディレクトリ。
 * @param branch - ブランチ名(refs/heads/ を除いた形)。
 * @returns worktree のパス。無ければ null。
 */
export const worktreePathOfBranch = (cwd: string, branch: string): string | null => {
  const output = git(cwd, ["worktree", "list", "--porcelain"]);
  if (output === null) {
    return null;
  }
  for (const block of output.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (path !== undefined && lines.includes(`branch refs/heads/${branch}`)) {
      return path;
    }
  }
  return null;
};

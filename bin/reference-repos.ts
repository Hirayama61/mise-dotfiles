import { homedir } from "node:os";
import { join } from "node:path";

// mise run のタスクには mise 自身の PATH が通らないので、mise.toml が絶対パスを渡す。
const miseBin = process.env.MISE_BIN ?? "mise";

const repoRoot = join(import.meta.dir, "..");
const miseTomlPath = join(repoRoot, "mise.toml");
export const settingsPath = join(repoRoot, ".claude", "settings.json");

// 参照リポは ghq の既定レイアウトに置く。~ のまま書くので、端末をまたいで同じ表記になる。
const ghqPrefix = "~/ghq/";

/** .claude/settings.json のうち、参照リポの宣言から生成する部分。 */
export type ReferenceSettings = {
  permissions: { additionalDirectories: string[]; deny: string[] };
};

/**
 * mise.toml の [bootstrap.repos] から参照リポのパスを取り出す。
 *
 * パスは ~/ghq/ で始まる表記に限る。端末固有の絶対パスや ghq の外を commit させない。
 *
 * @param miseToml - mise.toml を TOML として読んだ値。
 * @returns ~ のままのパス。宣言順を保つ。
 */
export const referencePaths = (miseToml: unknown): string[] => {
  const bootstrap = (miseToml as { bootstrap?: { repos?: unknown } } | null)?.bootstrap;
  const repos = bootstrap?.repos ?? {};
  if (typeof repos !== "object" || repos === null || Array.isArray(repos)) {
    throw new Error("mise.toml の [bootstrap.repos] がテーブルでない");
  }
  const paths = Object.keys(repos);
  const outside = paths.filter((path) => !path.startsWith(ghqPrefix));
  if (outside.length > 0) {
    throw new Error(`[bootstrap.repos] のキーは ${ghqPrefix} で始める: ${outside.join(", ")}`);
  }
  return paths;
};

/**
 * 参照リポのパスから、Claude Code に読ませて書かせない設定を作る。
 *
 * additionalDirectories はファイルアクセスだけを与え、参照リポの設定ファイルは読み込まない。
 * 読み取り専用にするオプションは無いので、編集系ツールを deny の Edit で止めて近似する。
 *
 * @param paths - ~ のままの参照リポのパス。
 * @returns .claude/settings.json の中身。
 */
export const buildSettings = (paths: readonly string[]): ReferenceSettings => ({
  permissions: {
    additionalDirectories: [...paths],
    deny: paths.map((path) => `Edit(${path}/**)`),
  },
});

/**
 * ghq が clone する先の root を、ghq と同じ優先順で求める。
 *
 * 優先順は GHQ_ROOT(区切りが複数なら先頭)→ git config の ghq.root(複数なら先頭)→ ~/ghq。
 *
 * @param envRoot - GHQ_ROOT の値。
 * @param gitConfigRoots - git config --get-all ghq.root の出力。
 * @param home - ホームディレクトリ。
 * @returns ~ を展開した root。
 */
export const resolveGhqRoot = (
  envRoot: string | undefined,
  gitConfigRoots: string | null,
  home: string,
): string => {
  const candidate =
    envRoot?.split(":")[0] || gitConfigRoots?.split("\n")[0]?.trim() || join(home, "ghq");
  const expanded =
    candidate === "~" || candidate.startsWith("~/") ? home + candidate.slice(1) : candidate;
  return expanded.replace(/\/+$/, "");
};

const readMiseToml = async (): Promise<unknown> =>
  Bun.TOML.parse(await Bun.file(miseTomlPath).text());

const capture = (command: readonly string[]): string | null => {
  try {
    const result = Bun.spawnSync([...command], { stdout: "pipe", stderr: "ignore" });
    return result.success ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
};

/**
 * 参照リポを ghq のレイアウトへ揃える。
 *
 * 宣言は ~/ghq を前提にしているので、ghq の root が別の端末では clone 先と ghq の管理がずれる。
 * そのときは clone せずに止め、知らせる。
 */
const syncRepos = (): void => {
  const home = homedir();
  const root = resolveGhqRoot(
    process.env.GHQ_ROOT,
    capture(["git", "config", "--get-all", "ghq.root"]),
    home,
  );
  if (root !== join(home, "ghq")) {
    console.error(
      `ghq の root が ${root} で、参照リポの宣言(${ghqPrefix})と食い違うため clone しない`,
    );
    process.exit(1);
  }
  // 収束と、dirty な作業ツリーを上書きしない安全策は mise bootstrap が持つ。
  const result = Bun.spawnSync([miseBin, "bootstrap", "--only", "repos", "--yes"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(result.exitCode ?? 1);
};

/**
 * 宣言から作った設定を返す。テストが commit 済みの .claude/settings.json と突き合わせる。
 *
 * @returns mise.toml の [bootstrap.repos] から生成した設定。
 */
export const expectedSettings = async (): Promise<ReferenceSettings> =>
  buildSettings(referencePaths(await readMiseToml()));

/** .claude/settings.json を mise.toml の宣言から生成し直す。 */
const writeSettings = async (): Promise<void> => {
  const settings = await expectedSettings();
  await Bun.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(
    `更新: .claude/settings.json(参照リポ ${settings.permissions.additionalDirectories.length} 件)`,
  );
};

/**
 * 参照用 OSS を扱う任意タスクの入口。
 *
 * sync は mise.toml の [bootstrap.repos] を ghq のレイアウトへ clone する(mise run refs)。
 * settings は同じ宣言から .claude/settings.json を生成し直す(mise run refs:settings)。
 * mise run setup はこの clone を走らせない。
 *
 * @param mode - sync か settings。
 */
const runReferenceRepos = async (mode: string | undefined): Promise<void> => {
  if (mode === "sync") {
    syncRepos();
  } else if (mode === "settings") {
    await writeSettings();
  } else {
    console.error("使い方: bun bin/reference-repos.ts <sync|settings>");
    process.exit(2);
  }
};

if (import.meta.main) {
  runReferenceRepos(process.argv[2]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

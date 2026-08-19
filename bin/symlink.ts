import { lstatSync, mkdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

// repo: リポジトリ内の作成元 / home: ホームディレクトリ配下の配置先
const links = [{ repo: "claude/rules", home: ".claude/rules" }] as const;

/**
 * lstat の結果を返す。
 *
 * @param path - 調べるパス。
 * @returns lstat の結果。パスが存在しなければ null。存在以外の失敗は再送出する。
 */
const lstatOrNull = (path: string) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

/**
 * 1 件の symlink を作成する。
 *
 * @param entry - 対応表の 1 項目。
 * @returns 作成または確認できたら true。配置先に symlink でない実体がある場合は、壊さず警告して false。
 */
const link = ({ repo, home }: (typeof links)[number]): boolean => {
  const repoPath = join(repoRoot, repo);
  const homePath = join(homedir(), home);

  if (lstatOrNull(repoPath) === null) {
    console.error(`欠落: ${repo} がリポジトリに無い`);
    return false;
  }

  const homeStat = lstatOrNull(homePath);
  if (homeStat?.isSymbolicLink()) {
    if (readlinkSync(homePath) === repoPath) {
      console.log(`確認: ~/${home}`);
      return true;
    }
  } else if (homeStat !== null) {
    console.error(`退避が必要: ~/${home} は symlink でないため上書きしない`);
    return false;
  }

  // 既存 symlink の置き換え中に失敗しても壊れないよう、一時リンク経由で原子的に置き換える。
  mkdirSync(dirname(homePath), { recursive: true });
  const stagingPath = `${homePath}.staging`;
  rmSync(stagingPath, { force: true });
  symlinkSync(repoPath, stagingPath);
  renameSync(stagingPath, homePath);
  console.log(`作成: ~/${home} -> ${repo}`);
  return true;
};

/**
 * リポジトリで管理する設定ファイルをホームディレクトリへ symlink する。
 *
 * 対応表の全件を適用し、作成できなかった項目があれば終了コード 1 で終える。
 */
const runSymlink = (): void => {
  const blocked = links.filter((entry) => !link(entry)).length;
  if (blocked > 0) {
    process.exit(1);
  }
};

if (import.meta.main) {
  runSymlink();
}

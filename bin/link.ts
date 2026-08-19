// リポジトリで管理する設定ファイルをホームディレクトリへ symlink する。

import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

// repo: リポジトリ内の作成元 / home: ホームディレクトリ配下の配置先
const links = [{ repo: "claude/rules", home: ".claude/rules" }] as const;

/** path を lstat した結果を返す。存在しなければ null。 */
const lstatOrNull = (path: string) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

/**
 * 1 件の symlink を作成し、成否を返す。
 * 配置先に symlink でない実体がある場合は、壊さず警告して false を返す。
 */
const link = ({ repo, home }: { repo: string; home: string }): boolean => {
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
    unlinkSync(homePath);
  } else if (homeStat !== null) {
    console.error(`退避が必要: ~/${home} は symlink でないため上書きしない`);
    return false;
  }

  mkdirSync(dirname(homePath), { recursive: true });
  symlinkSync(repoPath, homePath);
  console.log(`作成: ~/${home} -> ${repo}`);
  return true;
};

/** 対応表の全件を適用し、作成できなかった項目があれば終了コード 1 で終える。 */
const main = (): void => {
  const blocked = links.filter((entry) => !link(entry)).length;
  if (blocked > 0) {
    process.exit(1);
  }
};

main();

// リポジトリで管理する設定ファイルをホームディレクトリへ symlink する。
// 配置先に symlink でない実体がある場合は、壊さず警告して終了コード 1 を返す。

import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

// リポジトリ内パス → ホームディレクトリ配下の配置先
const links: readonly (readonly [string, string])[] = [
  ["claude/CLAUDE.md", ".claude/CLAUDE.md"],
  ["claude/japanese-writing.md", ".claude/japanese-writing.md"],
];

const lstatOrNull = (path: string) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

let blocked = 0;

for (const [src, dest] of links) {
  const srcPath = join(repoRoot, src);
  const destPath = join(homedir(), dest);

  if (lstatOrNull(srcPath) === null) {
    console.error(`欠落: ${src} がリポジトリに無い`);
    blocked += 1;
    continue;
  }

  const destStat = lstatOrNull(destPath);
  if (destStat?.isSymbolicLink()) {
    if (readlinkSync(destPath) === srcPath) {
      console.log(`確認: ~/${dest}`);
      continue;
    }
    unlinkSync(destPath);
  } else if (destStat !== null) {
    console.error(`退避が必要: ~/${dest} は symlink でないため上書きしない`);
    blocked += 1;
    continue;
  }

  mkdirSync(dirname(destPath), { recursive: true });
  symlinkSync(srcPath, destPath);
  console.log(`作成: ~/${dest} -> ${src}`);
}

if (blocked > 0) {
  process.exit(1);
}

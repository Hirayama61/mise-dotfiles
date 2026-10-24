import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { denyToolUse, readHookInput } from "./lib/hook-input.ts";
import {
  type PushDiff,
  assessRisk,
  flagPath,
  hasApproval,
  resolvePushDiff,
  reviewCommand,
} from "./lib/review-gate.ts";
import { splitSimpleCommands, stripCommandPrefix } from "./lib/shell-words.ts";

// block-irreversible-git も push を止めるので、どちらが止めたかを文面の先頭で示す。
const hookName = "review-gate";

// 引数付きで次の語を値に取る git のグローバルオプション。
const gitGlobalsWithValue = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--super-prefix",
]);

// force 系は block-irreversible-git が止める。dry-run と削除はレビュー対象の差分を送らない。
const skippedPushLongs = new Set([
  "--force",
  "--force-with-lease",
  "--force-if-includes",
  "--mirror",
  "--dry-run",
  "--delete",
]);
const skippedPushShorts = /^-[^-]*[fnd]/;

const expandHome = (path: string): string =>
  path === "~" || path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;

const programName = (word: string): string => word.split("/").at(-1) ?? word;

/**
 * push の引数のうち、レビューゲートの対象外にするものがあるかを判定する。
 *
 * @param args - `git push` に続く語。
 * @returns force・dry-run・削除なら true。
 */
const isSkippedPush = (args: readonly string[]): boolean =>
  args.some(
    (arg) => skippedPushLongs.has(arg.split("=", 1)[0] ?? arg) || skippedPushShorts.test(arg),
  );

/**
 * 単純コマンドが git push なら、その作業ディレクトリを返す。
 *
 * @param words - 単純コマンドの語。
 * @param cwd - このコマンドを実行するディレクトリ。
 * @returns ゲートの対象になる push の作業ディレクトリ。push でなければ null。
 */
const pushDirOf = (words: readonly string[], cwd: string): string | null => {
  const [program, ...rest] = stripCommandPrefix(words);
  if (program === undefined || programName(program) !== "git") {
    return null;
  }
  let dir = cwd;
  let index = 0;
  while (index < rest.length) {
    const word = rest[index] ?? "";
    if (word === "-C") {
      dir = resolve(dir, expandHome(rest[index + 1] ?? "."));
    }
    if (gitGlobalsWithValue.has(word)) {
      index += 2;
    } else if (word.startsWith("-")) {
      index += 1;
    } else {
      return word === "push" && !isSkippedPush(rest.slice(index + 1)) ? dir : null;
    }
  }
  return null;
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * コマンドに含まれる、ゲートの対象になる push の作業ディレクトリを列挙する。
 *
 * `cd <dir> && git push` と `git -C <dir> push` は、その dir で判定する。
 * サブシェル内の cd は外へ漏れないので、経路が接頭辞になっているスコープの cd だけを見る。
 *
 * @param command - Bash ツールに渡されたコマンド。
 * @param cwd - セッションの作業ディレクトリ。
 * @returns push ごとの作業ディレクトリ。
 */
const findPushDirs = (command: string, cwd: string): string[] => {
  const dirsByScope = new Map<string, string>();
  const dirs: string[] = [];
  for (const { words, scope } of splitSimpleCommands(command)) {
    let current = cwd;
    for (let length = scope.length; length >= 0; length -= 1) {
      const dir = dirsByScope.get(scope.slice(0, length).join(","));
      if (dir !== undefined) {
        current = dir;
        break;
      }
    }
    const [program, ...rest] = stripCommandPrefix(words);
    if (program === "cd") {
      const target = resolve(
        current,
        expandHome(rest.find((word) => !word.startsWith("-")) ?? "~"),
      );
      // 存在しない dir への cd は失敗し、作業ディレクトリは変わらない。
      if (isDirectory(target)) {
        dirsByScope.set(scope.join(","), target);
      }
      continue;
    }
    const pushDir = pushDirOf(words, current);
    if (pushDir !== null) {
      dirs.push(pushDir);
    }
  }
  return dirs;
};

const denyReason = (diff: PushDiff): string => {
  const { level, effort, reasons } = assessRisk(diff.files, diff.changedLines);
  const bun = process.execPath;
  return [
    `[${hookName}] この diff はレビュー済みの flag が無いので push できない。`,
    `対象: ${diff.baseRef} との merge-base(${diff.base.slice(0, 12)})..HEAD、${diff.files.length} ファイル・${diff.changedLines} 行`,
    `fingerprint: ${diff.fingerprint}`,
    `risk: ${level.toUpperCase()}${reasons.length > 0 ? `(${reasons.join(" / ")})` : ""}`,
    `review-gate skill の手順に進み、人間に \`${reviewCommand(effort, diff.base)}\` の実行を依頼する。`,
    `状態の確認と flag の発行: "${bun}" "$HOME/.claude/skills/review-gate/review-flag.ts" status`,
    "Claude が /code-review を起動したり、レビューを経ずに flag を発行したりしない。",
  ].join("\n");
};

/**
 * PreToolUse(Bash)hook。
 *
 * Claude の `git push` を検知し、push で送る差分の fingerprint に承認済みの review flag が無ければ拒否する。
 * 拒否の理由には、差分の risk に応じた `/code-review <effort>` を載せる。
 * flag はレビューエンジンを問わず、fingerprint の承認だけを見る。
 * force 系は block-irreversible-git が止めるので判定しない。人間の `!git push` は hook を通らない。
 * 判定できない入力(JSON 不正・git 外・起点不明)と hook 自身の失敗は素通しにする。
 */
const runReviewGate = async (): Promise<void> => {
  const input = await readHookInput();
  const command = input?.tool_input?.command;
  if (input === null || input.tool_name !== "Bash" || typeof command !== "string") {
    return;
  }
  try {
    for (const dir of findPushDirs(command, input.cwd ?? process.cwd())) {
      const diff = resolvePushDiff(dir);
      if (diff === null) {
        continue;
      }
      const path = flagPath(dir, diff.fingerprint);
      if (path !== null && !(await hasApproval(path, diff.fingerprint))) {
        denyToolUse(denyReason(diff));
        return;
      }
    }
  } catch {
    // 解析の取りこぼしで Bash 全体を止めない。
  }
};

if (import.meta.main) {
  await runReviewGate();
}

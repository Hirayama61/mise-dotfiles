import { homedir } from "node:os";
import { resolve } from "node:path";

import { git } from "./lib/git.ts";
import { denyToolUse, readHookInput } from "./lib/hook-input.ts";
import { splitSimpleCommands, stripCommandPrefix } from "./lib/shell-words.ts";

/** 止める理由。Claude に見せる文面の部品。 */
type Block = {
  /** 止めた操作の呼び名。 */
  operation: string;
  why: string;
  /** Claude が代わりに取る行動。 */
  instead: string;
};

/** サブコマンドの引数を、値を取るオプションを考慮して分けたもの。 */
type ParsedArgs = {
  /** 短縮オプションの文字。`-fd` なら f と d。 */
  shorts: ReadonlySet<string>;
  /** `--` 始まりのオプション名。`=` 以降は含まない。 */
  longs: ReadonlySet<string>;
  positionals: readonly string[];
  hasDoubleDash: boolean;
};

/** オプションの値が次の語に来るもの。値を誤ってオプションや引数と読まないために使う。 */
type OptionSpec = { shortsWithValue: string; longsWithValue: readonly string[] };

type GitInvocation = { dir: string; subcommand: string; args: ParsedArgs };

type GhInvocation = { group: string; action: string };

/** 単純コマンドを解釈した結果。cd は以降の git の作業ディレクトリを変える。 */
type Invocation =
  | { kind: "cd"; dir: string }
  | { kind: "git"; dir: string; subcommand: string; rest: readonly string[] }
  | { kind: "gh"; gh: GhInvocation }
  | { kind: "other" };

// #12 の push 前レビューゲートも push を止めるので、どちらが止めたかを文面の先頭で示す。
const hookName = "block-irreversible-git";

const protectedBranches = new Set(["main", "master", "develop"]);

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

const optionSpecs: Record<string, OptionSpec> = {
  push: {
    shortsWithValue: "o",
    longsWithValue: ["--push-option", "--repo", "--receive-pack", "--exec"],
  },
  commit: {
    shortsWithValue: "mFCct",
    longsWithValue: [
      "--message",
      "--file",
      "--author",
      "--date",
      "--reuse-message",
      "--reedit-message",
      "--fixup",
      "--squash",
      "--template",
      "--cleanup",
      "--trailer",
      "--pathspec-from-file",
    ],
  },
  checkout: { shortsWithValue: "bB", longsWithValue: ["--orphan", "--pathspec-from-file"] },
  switch: { shortsWithValue: "cC", longsWithValue: ["--create", "--force-create", "--orphan"] },
  restore: { shortsWithValue: "s", longsWithValue: ["--source", "--pathspec-from-file"] },
  clean: { shortsWithValue: "e", longsWithValue: ["--exclude"] },
  stash: { shortsWithValue: "m", longsWithValue: ["--message", "--pathspec-from-file"] },
  branch: {
    shortsWithValue: "u",
    longsWithValue: [
      "--set-upstream-to",
      "--contains",
      "--no-contains",
      "--merged",
      "--no-merged",
      "--points-at",
      "--sort",
      "--format",
    ],
  },
  merge: {
    shortsWithValue: "msX",
    longsWithValue: ["--message", "--file", "--strategy", "--strategy-option"],
  },
};

const noValueSpec: OptionSpec = { shortsWithValue: "", longsWithValue: [] };

const blockedGhActions: Record<string, ReadonlySet<string>> = {
  pr: new Set(["merge", "close", "ready"]),
  release: new Set(["create", "delete", "edit"]),
  repo: new Set(["delete", "archive", "edit"]),
};

const discardWhy = "未コミットの変更や stash を復元できない形で捨てる。";
const discardInstead = "捨ててよい変更かを人間に確認する。";

const parseArgs = (args: readonly string[], spec: OptionSpec): ParsedArgs => {
  const shorts = new Set<string>();
  const longs = new Set<string>();
  const positionals: string[] = [];
  let hasDoubleDash = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (hasDoubleDash) {
      positionals.push(arg);
    } else if (arg === "--") {
      hasDoubleDash = true;
    } else if (arg.startsWith("--")) {
      const name = arg.split("=", 1)[0] ?? arg;
      longs.add(name);
      if (!arg.includes("=") && spec.longsWithValue.includes(name)) {
        index += 1;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // `-am msg` の m 以降は値。`-mfix` のように値が続けて書かれた形もここで打ち切る。
      for (let at = 1; at < arg.length; at += 1) {
        const char = arg[at] ?? "";
        shorts.add(char);
        if (spec.shortsWithValue.includes(char)) {
          index += at === arg.length - 1 ? 1 : 0;
          break;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { shorts, longs, positionals, hasDoubleDash };
};

const hasOption = (args: ParsedArgs, long: string, short = ""): boolean =>
  args.longs.has(long) || (short !== "" && args.shorts.has(short));

const expandHome = (path: string): string =>
  path === "~" || path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;

const programName = (word: string): string => word.split("/").at(-1) ?? word;

/**
 * 単純コマンドを、遮断の判定に使う形へ解釈する。
 *
 * @param words - 単純コマンドの語。
 * @param cwd - このコマンドを実行するディレクトリ。
 * @returns cd・git・gh のいずれか。それ以外は other。
 */
const interpret = (words: readonly string[], cwd: string): Invocation => {
  const [program, ...rest] = stripCommandPrefix(words);
  if (program === "cd") {
    const target = rest.find((word) => !word.startsWith("-"));
    return { kind: "cd", dir: resolve(cwd, expandHome(target ?? "~")) };
  }
  if (program !== undefined && programName(program) === "git") {
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
        return { kind: "git", dir, subcommand: word, rest: rest.slice(index + 1) };
      }
    }
    return { kind: "other" };
  }
  if (program !== undefined && programName(program) === "gh") {
    const positionals: string[] = [];
    for (let index = 0; index < rest.length && positionals.length < 2; index += 1) {
      const word = rest[index] ?? "";
      if (word === "-R" || word === "--repo") {
        index += 1;
      } else if (!word.startsWith("-")) {
        positionals.push(word);
      }
    }
    const [group, action] = positionals;
    return group !== undefined && action !== undefined
      ? { kind: "gh", gh: { group, action } }
      : { kind: "other" };
  }
  return { kind: "other" };
};

const isForcePush = (args: ParsedArgs): boolean =>
  hasOption(args, "--force", "f") ||
  args.longs.has("--force-with-lease") ||
  args.longs.has("--force-if-includes");

// ref 名に使えない形(git check-ref-format)の引数は pathspec と確定し、checkout は変更を捨てる。
// ref 名としても妥当な `src/main.ts` のような形は区別できないので通す。
const looksLikePathspec = (arg: string): boolean =>
  /^[./~]/.test(arg) || arg.endsWith("/") || /[*?]/.test(arg);

/**
 * 文脈を見ずに字句だけで決まる git の遮断。
 *
 * @param subcommand - git のサブコマンド。
 * @param args - サブコマンドの引数。
 * @returns 止めるなら理由。止めないなら null。
 */
const lexicalGitBlock = (subcommand: string, args: ParsedArgs): Block | null => {
  const [first] = args.positionals;
  switch (subcommand) {
    case "push":
      return isForcePush(args)
        ? {
            operation: "git push --force(--force-with-lease / -f を含む)",
            why: "remote の履歴を書き換え、push 済みのコミットを消しうる。",
            instead: "通常の push で済むよう、修正は新しいコミットとして積む。",
          }
        : null;
    case "commit":
      return hasOption(args, "--no-verify", "n")
        ? {
            operation: "git commit --no-verify",
            why: "pre-commit / commit-msg フックを飛ばすと、lint と秘密情報の検査が抜ける。",
            instead: "フックが落ちた原因を直してから commit する。",
          }
        : null;
    case "reset":
      return args.longs.has("--hard")
        ? { operation: "git reset --hard", why: discardWhy, instead: discardInstead }
        : null;
    case "clean":
      return hasOption(args, "--force", "f") && !hasOption(args, "--dry-run", "n")
        ? { operation: "git clean -f", why: discardWhy, instead: discardInstead }
        : null;
    case "stash":
      return first === "drop" || first === "clear"
        ? { operation: `git stash ${first}`, why: discardWhy, instead: discardInstead }
        : null;
    case "checkout":
      if (hasOption(args, "--force", "f")) {
        return { operation: "git checkout -f", why: discardWhy, instead: discardInstead };
      }
      return args.hasDoubleDash || args.positionals.some(looksLikePathspec)
        ? { operation: "git checkout <path>", why: discardWhy, instead: discardInstead }
        : null;
    case "switch":
      return hasOption(args, "--discard-changes") || hasOption(args, "--force", "f")
        ? { operation: "git switch --discard-changes", why: discardWhy, instead: discardInstead }
        : null;
    case "restore":
      // --staged だけなら index を戻すだけで、作業ツリーの変更は残る。
      return hasOption(args, "--worktree", "W") || !hasOption(args, "--staged", "S")
        ? { operation: "git restore", why: discardWhy, instead: discardInstead }
        : null;
    case "branch":
      return args.shorts.has("D") ||
        (hasOption(args, "--delete", "d") && hasOption(args, "--force", "f"))
        ? {
            operation: "git branch -D",
            why: "merge されていないコミットごとブランチを消す。",
            instead: discardInstead,
          }
        : null;
    case "worktree":
      return first === "remove" && hasOption(args, "--force", "f")
        ? {
            operation: "git worktree remove --force",
            why: "worktree の未コミットの変更ごと消す。",
            instead: discardInstead,
          }
        : null;
    default:
      return null;
  }
};

/**
 * gh の外向き操作の遮断。
 *
 * @param gh - gh のサブコマンドと操作。
 * @returns 止めるなら理由。止めないなら null。
 */
const ghBlock = ({ group, action }: GhInvocation): Block | null =>
  blockedGhActions[group]?.has(action) === true
    ? {
        operation: `gh ${group} ${action}`,
        why: "PR・リリース・リポジトリの状態を、外から見える形で変える。",
        instead: "実行するコマンドを人間に提示し、判断を仰ぐ。",
      }
    : null;

const denyReason = ({ operation, why, instead }: Block): string =>
  [
    `[${hookName}] ${operation} は Claude からは実行できない。${why}`,
    instead,
    "人間が判断して実行する場合は、プロンプトで ! に続けてコマンドを入力してもらう(hook を通らない)。",
  ].join("\n");

/**
 * 現在ブランチと HEAD の push 状況を見て決まる git の遮断。
 *
 * git 外・detached HEAD・コミットが無いなど判定できないときは止めない。
 *
 * @param invocation - 解釈済みの git コマンド。
 * @returns 止めるなら理由。止めないなら null。
 */
const contextualGitBlock = ({ dir, subcommand, args }: GitInvocation): Block | null => {
  // --abort は進行中の merge を取り消すだけで履歴を変えない。
  const isMerge = subcommand === "merge" && !args.longs.has("--abort") && !args.longs.has("--quit");
  if (subcommand === "push" || isMerge) {
    const branch = git(dir, ["branch", "--show-current"]);
    if (branch !== null && protectedBranches.has(branch)) {
      return {
        operation: `保護ブランチ ${branch} での git ${subcommand}`,
        why: "レビューを経ずに共有の履歴が変わる。",
        instead: "feature ブランチで作業し、PR を作る。",
      };
    }
  }
  if (subcommand === "commit" && args.longs.has("--amend")) {
    if (git(dir, ["rev-parse", "--verify", "-q", "HEAD"]) === null) {
      return null;
    }
    // remote を fetch していないと push 済みを取りこぼす。不明なら通す側に倒す。
    const remoteBranches = git(dir, ["branch", "-r", "--contains", "HEAD"]);
    if (remoteBranches !== null && remoteBranches !== "") {
      return {
        operation: "push 済みの HEAD への git commit --amend",
        why: "反映するには force push が要る。",
        instead: "修正は新しいコミットとして積む。",
      };
    }
  }
  return null;
};

/**
 * コマンド全体を単純コマンドに分け、最初に見つかった遮断を返す。
 *
 * `cd <dir> && git ...` と `git -C <dir> ...` は、その dir を作業ディレクトリとして判定する。
 *
 * @param command - Bash ツールに渡されたコマンド。
 * @param cwd - セッションの作業ディレクトリ。
 * @returns 止めるなら理由。止めないなら null。
 */
const findBlock = (command: string, cwd: string): Block | null => {
  let currentDir = cwd;
  for (const words of splitSimpleCommands(command)) {
    const invocation = interpret(words, currentDir);
    if (invocation.kind === "cd") {
      currentDir = invocation.dir;
    } else if (invocation.kind === "gh") {
      const block = ghBlock(invocation.gh);
      if (block !== null) {
        return block;
      }
    } else if (invocation.kind === "git") {
      const { dir, subcommand } = invocation;
      const args = parseArgs(invocation.rest, optionSpecs[subcommand] ?? noValueSpec);
      const block =
        lexicalGitBlock(subcommand, args) ?? contextualGitBlock({ dir, subcommand, args });
      if (block !== null) {
        return block;
      }
    }
  }
  return null;
};

/**
 * PreToolUse(Bash)hook。
 *
 * force push・保護ブランチでの push / merge・未コミット作業を捨てる git 操作・
 * push 済み HEAD の amend・commit --no-verify・gh の外向き操作を拒否する。
 * 人間はプロンプトの ! で同じコマンドを実行できる(hook を通らない)。
 * 判定は字句の best-effort で、alias・`bash -c`・変数展開は対象外。
 * 判定できない入力(JSON 不正・git 外・ブランチ不明)と hook 自身の失敗は素通しにする。
 */
const runBlockIrreversibleGit = async (): Promise<void> => {
  const input = await readHookInput();
  const command = input?.tool_input?.command;
  if (input === null || input.tool_name !== "Bash" || typeof command !== "string") {
    return;
  }
  try {
    const block = findBlock(command, input.cwd ?? process.cwd());
    if (block !== null) {
      denyToolUse(denyReason(block));
    }
  } catch {
    // 解析の取りこぼしで Bash 全体を止めない。
  }
};

if (import.meta.main) {
  await runBlockIrreversibleGit();
}

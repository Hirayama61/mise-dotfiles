import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { git } from "./lib/git.ts";
import { denyToolUse, readHookInput } from "./lib/hook-input.ts";
import { type SimpleCommand, splitSimpleCommands, stripCommandPrefix } from "./lib/shell-words.ts";

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
  /** 値を取るオプションの値。キーは `-c` や `--create` のように書かれた形。 */
  values: ReadonlyMap<string, string>;
  hasDoubleDash: boolean;
};

/** parseArgs が組み立て中の ParsedArgs。 */
type MutableParsedArgs = {
  shorts: Set<string>;
  longs: Set<string>;
  positionals: string[];
  values: Map<string, string>;
  hasDoubleDash: boolean;
};

/** オプションの値が次の語に来るもの。値を誤ってオプションや引数と読まないために使う。 */
type OptionSpec = { shortsWithValue: string; longsWithValue: readonly string[] };

type GitInvocation = { dir: string; subcommand: string; args: ParsedArgs };

/** git の作業ディレクトリから、その時点の現在ブランチを返す。不明は null。 */
type BranchLookup = (dir: string) => string | null;

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

// 新しいブランチを作って切り替えるオプション。値が切り替え先のブランチ名になる。
const branchCreateOptions: Record<string, readonly string[]> = {
  switch: ["-c", "-C", "--create", "--force-create", "--orphan"],
  checkout: ["-b", "-B", "--orphan"],
};

const noValueSpec: OptionSpec = { shortsWithValue: "", longsWithValue: [] };

const blockedGhActions: Record<string, ReadonlySet<string>> = {
  pr: new Set(["merge", "close", "ready"]),
  release: new Set(["create", "delete", "edit"]),
  repo: new Set(["delete", "archive", "edit"]),
};

const discardWhy = "未コミットの変更や stash を復元できない形で捨てる。";
const discardInstead = "捨ててよい変更かを人間に確認する。";

/**
 * `--name` / `--name=value` を読む。
 *
 * @returns 値として消費した後続の語の数。
 */
const readLongOption = (
  args: readonly string[],
  index: number,
  spec: OptionSpec,
  parsed: MutableParsedArgs,
): number => {
  const arg = args[index] ?? "";
  const name = arg.split("=", 1)[0] ?? arg;
  parsed.longs.add(name);
  if (arg.includes("=")) {
    parsed.values.set(name, arg.slice(name.length + 1));
    return 0;
  }
  if (spec.longsWithValue.includes(name)) {
    parsed.values.set(name, args[index + 1] ?? "");
    return 1;
  }
  return 0;
};

/**
 * `-fd` のような短縮オプションのまとまりを読む。
 *
 * @returns 値として消費した後続の語の数。
 */
const readShortOptions = (
  args: readonly string[],
  index: number,
  spec: OptionSpec,
  parsed: MutableParsedArgs,
): number => {
  const arg = args[index] ?? "";
  // `-am msg` の m 以降は値。`-mfix` のように値が続けて書かれた形もここで打ち切る。
  for (let at = 1; at < arg.length; at += 1) {
    const char = arg[at] ?? "";
    parsed.shorts.add(char);
    if (spec.shortsWithValue.includes(char)) {
      const attached = arg.slice(at + 1);
      parsed.values.set(`-${char}`, attached === "" ? (args[index + 1] ?? "") : attached);
      return attached === "" ? 1 : 0;
    }
  }
  return 0;
};

const parseArgs = (args: readonly string[], spec: OptionSpec): ParsedArgs => {
  const parsed: MutableParsedArgs = {
    shorts: new Set(),
    longs: new Set(),
    positionals: [],
    values: new Map(),
    hasDoubleDash: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (parsed.hasDoubleDash) {
      parsed.positionals.push(arg);
    } else if (arg === "--") {
      parsed.hasDoubleDash = true;
    } else if (arg.startsWith("--")) {
      index += readLongOption(args, index, spec, parsed);
    } else if (arg.startsWith("-") && arg.length > 1) {
      index += readShortOptions(args, index, spec, parsed);
    } else {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
};

const hasOption = (args: ParsedArgs, long: string, short = ""): boolean =>
  args.longs.has(long) || (short !== "" && args.shorts.has(short));

const expandHome = (path: string): string =>
  path === "~" || path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;

const programName = (word: string): string => word.split("/").at(-1) ?? word;

/** git のグローバルオプションを越えて、サブコマンドと作業ディレクトリを取り出す。 */
const interpretGit = (rest: readonly string[], cwd: string): Invocation => {
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
};

/** gh の先頭 2 つの位置引数を、サブコマンドと操作として取り出す。 */
const interpretGh = (rest: readonly string[]): Invocation => {
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
};

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
    return interpretGit(rest, cwd);
  }
  if (program !== undefined && programName(program) === "gh") {
    return interpretGh(rest);
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
 * switch / checkout が切り替える先のブランチを返す。
 *
 * 新規作成(`-c` / `-b` など)はその名前、`--detach` は空文字(どのブランチでもない)。
 * 直前のブランチを指す `-` は字句では決まらないので `-` のまま返す。
 *
 * @param subcommand - git のサブコマンド。
 * @param args - サブコマンドの引数。
 * @returns 切り替え先。ブランチを切り替えないコマンドなら null。
 */
const switchedBranch = (subcommand: string, args: ParsedArgs): string | null => {
  const createOptions = branchCreateOptions[subcommand];
  if (createOptions === undefined || args.hasDoubleDash) {
    return null;
  }
  const created = createOptions.map((option) => args.values.get(option)).find(Boolean);
  if (created !== undefined) {
    return created;
  }
  if (args.longs.has("--detach")) {
    return "";
  }
  return args.positionals[0] ?? null;
};

// サブコマンドごとの字句だけで決まる遮断。
const lexicalGitBlocks: Record<string, (args: ParsedArgs) => Block | null> = {
  push: (args) =>
    isForcePush(args)
      ? {
          operation: "git push --force(--force-with-lease / -f を含む)",
          why: "remote の履歴を書き換え、push 済みのコミットを消しうる。",
          instead: "通常の push で済むよう、修正は新しいコミットとして積む。",
        }
      : null,
  commit: (args) =>
    hasOption(args, "--no-verify", "n")
      ? {
          operation: "git commit --no-verify",
          why: "pre-commit / commit-msg フックを飛ばすと、lint と秘密情報の検査が抜ける。",
          instead: "フックが落ちた原因を直してから commit する。",
        }
      : null,
  reset: (args) =>
    args.longs.has("--hard")
      ? { operation: "git reset --hard", why: discardWhy, instead: discardInstead }
      : null,
  clean: (args) =>
    hasOption(args, "--force", "f") && !hasOption(args, "--dry-run", "n")
      ? { operation: "git clean -f", why: discardWhy, instead: discardInstead }
      : null,
  stash: (args) => {
    const [first] = args.positionals;
    return first === "drop" || first === "clear"
      ? { operation: `git stash ${first}`, why: discardWhy, instead: discardInstead }
      : null;
  },
  checkout: (args) => {
    if (hasOption(args, "--force", "f")) {
      return { operation: "git checkout -f", why: discardWhy, instead: discardInstead };
    }
    return args.hasDoubleDash || args.positionals.some(looksLikePathspec)
      ? { operation: "git checkout <path>", why: discardWhy, instead: discardInstead }
      : null;
  },
  switch: (args) =>
    hasOption(args, "--discard-changes") || hasOption(args, "--force", "f")
      ? { operation: "git switch --discard-changes", why: discardWhy, instead: discardInstead }
      : null,
  // --staged だけなら index を戻すだけで、作業ツリーの変更は残る。
  restore: (args) =>
    hasOption(args, "--worktree", "W") || !hasOption(args, "--staged", "S")
      ? { operation: "git restore", why: discardWhy, instead: discardInstead }
      : null,
  branch: (args) =>
    args.shorts.has("D") || (hasOption(args, "--delete", "d") && hasOption(args, "--force", "f"))
      ? {
          operation: "git branch -D",
          why: "merge されていないコミットごとブランチを消す。",
          instead: discardInstead,
        }
      : null,
  worktree: (args) =>
    args.positionals[0] === "remove" && hasOption(args, "--force", "f")
      ? {
          operation: "git worktree remove --force",
          why: "worktree の未コミットの変更ごと消す。",
          instead: discardInstead,
        }
      : null,
};

/**
 * 文脈を見ずに字句だけで決まる git の遮断。
 *
 * @param subcommand - git のサブコマンド。
 * @param args - サブコマンドの引数。
 * @returns 止めるなら理由。止めないなら null。
 */
const lexicalGitBlock = (subcommand: string, args: ParsedArgs): Block | null =>
  Object.hasOwn(lexicalGitBlocks, subcommand)
    ? (lexicalGitBlocks[subcommand]?.(args) ?? null)
    : null;

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
 * 単純コマンドの作業ディレクトリを返す。
 *
 * サブシェル内の cd は外へ漏れないので、経路が接頭辞になっているスコープの cd だけを見る。
 *
 * @param dirsByScope - スコープの経路(`,` 区切り)ごとの、そこまでの cd の結果。
 * @param command - 対象の単純コマンド。
 * @param cwd - セッションの作業ディレクトリ。
 * @returns 最も内側のスコープで最後に cd した先。cd が無ければ cwd。
 */
const dirOfCommand = (
  dirsByScope: ReadonlyMap<string, string>,
  { scope }: SimpleCommand,
  cwd: string,
): string => {
  for (let length = scope.length; length >= 0; length -= 1) {
    const dir = dirsByScope.get(scope.slice(0, length).join(","));
    if (dir !== undefined) {
      return dir;
    }
  }
  return cwd;
};

/**
 * 現在ブランチと HEAD の push 状況を見て決まる git の遮断。
 *
 * git 外・detached HEAD・コミットが無いなど判定できないときは止めない。
 *
 * @param invocation - 解釈済みの git コマンド。
 * @param branchOf - 同じコマンド内の switch / checkout を反映した現在ブランチ。
 * @returns 止めるなら理由。止めないなら null。
 */
const contextualGitBlock = (
  { dir, subcommand, args }: GitInvocation,
  branchOf: BranchLookup,
): Block | null => {
  // --abort は進行中の merge を取り消すだけで履歴を変えない。
  const isMerge = subcommand === "merge" && !args.longs.has("--abort") && !args.longs.has("--quit");
  if (subcommand === "push" || isMerge) {
    const branch = branchOf(dir);
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

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * コマンド全体を単純コマンドに分け、最初に見つかった遮断を返す。
 *
 * `cd <dir> && git ...` と `git -C <dir> ...` は、その dir を作業ディレクトリとして判定する。
 * 先に switch / checkout したブランチは、後続の push / merge の現在ブランチとして扱う。
 *
 * @param command - Bash ツールに渡されたコマンド。
 * @param cwd - セッションの作業ディレクトリ。
 * @returns 止めるなら理由。止めないなら null。
 */
const findBlock = (command: string, cwd: string): Block | null => {
  const dirsByScope = new Map<string, string>();
  // HEAD は worktree ごとのファイルシステム上の状態なので、サブシェル内の switch も、
  // 同じ worktree の別ディレクトリからの push も、切り替え後のブランチで判定する。
  const switchedBranches = new Map<string, string>();
  const worktreeOf = (dir: string): string => git(dir, ["rev-parse", "--show-toplevel"]) ?? dir;
  const branchOf: BranchLookup = (dir) =>
    switchedBranches.get(worktreeOf(dir)) ?? git(dir, ["branch", "--show-current"]);

  for (const simpleCommand of splitSimpleCommands(command)) {
    const invocation = interpret(
      simpleCommand.words,
      dirOfCommand(dirsByScope, simpleCommand, cwd),
    );
    if (invocation.kind === "cd") {
      // 存在しない dir への cd は失敗し、作業ディレクトリは変わらない。
      if (isDirectory(invocation.dir)) {
        dirsByScope.set(simpleCommand.scope.join(","), invocation.dir);
      }
    } else if (invocation.kind === "gh") {
      const block = ghBlock(invocation.gh);
      if (block !== null) {
        return block;
      }
    } else if (invocation.kind === "git") {
      const { dir, subcommand } = invocation;
      const args = parseArgs(invocation.rest, optionSpecs[subcommand] ?? noValueSpec);
      const block =
        lexicalGitBlock(subcommand, args) ??
        contextualGitBlock({ dir, subcommand, args }, branchOf);
      if (block !== null) {
        return block;
      }
      const switched = switchedBranch(subcommand, args);
      if (switched !== null) {
        const resolved =
          switched === "-" ? git(dir, ["rev-parse", "--abbrev-ref", "@{-1}"]) : switched;
        // 切り替え先が分からなければ、実際の HEAD を見る側に戻す。
        if (resolved === null) {
          switchedBranches.delete(worktreeOf(dir));
        } else {
          switchedBranches.set(worktreeOf(dir), resolved);
        }
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

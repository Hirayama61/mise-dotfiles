import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import { isPrimaryWorktree } from "./lib/git.ts";
import { denyToolUse, readHookInput, type HookInput } from "./lib/hook-input.ts";

const realpathOrNull = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/**
 * ブロックの範囲。~/ghq 配下だけを見て、~/obsidian 等の開発リポジトリでない git 管理を巻き込まない。
 *
 * macOS では HOME や /tmp に symlink が混ざるため、HOME 側も実パスへ揃えてから接頭辞を比べる。
 *
 * @returns ghq root の実パス。HOME を解決できなければ null。
 */
const scopeRoot = (): string | null => {
  const home = realpathOrNull(homedir());
  return home === null ? null : join(home, "ghq");
};

/**
 * 編集対象のパスを取り出す。
 *
 * @param input - hook の入力。
 * @returns Edit / Write / MultiEdit の file_path、NotebookEdit の notebook_path。無ければ null。
 */
const editedFilePath = (input: HookInput): string | null => {
  const toolInput = input.tool_input ?? {};
  const candidate = toolInput.file_path ?? toolInput.notebook_path;
  return typeof candidate === "string" && candidate !== "" ? candidate : null;
};

const denyReason = (path: string): string =>
  [
    `${path} は main clone(~/ghq 配下のプライマリ作業ツリー)にあるため編集できない。`,
    "main clone は読み取りと集約の本体。EnterWorktree で worktree を作り、その中で編集する。",
    "人間が同じ配置に作るときは gwq add -b <branch>。",
  ].join("\n");

/**
 * PreToolUse(Edit|Write|MultiEdit|NotebookEdit)hook。
 *
 * ~/ghq 配下の main clone 本体への編集を拒否し、EnterWorktree へ案内する。
 * linked worktree はどこにあっても通す。判定できない入力(JSON 不正・相対パス・
 * 親ディレクトリ不在・git 不在)は安全側として素通しにする。
 */
const runBlockMainCloneEdit = async (): Promise<void> => {
  const input = await readHookInput();
  if (input === null) {
    return;
  }

  const filePath = editedFilePath(input);
  if (filePath === null || !isAbsolute(filePath)) {
    return;
  }

  const dir = realpathOrNull(dirname(filePath));
  const root = scopeRoot();
  if (dir === null || root === null || !dir.startsWith(`${root}/`)) {
    return;
  }

  if (!isPrimaryWorktree(dir)) {
    return;
  }

  denyToolUse(denyReason(join(dir, basename(filePath))));
};

if (import.meta.main) {
  await runBlockMainCloneEdit();
}

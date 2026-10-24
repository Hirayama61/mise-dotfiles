import { existsSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type HookCommand = { type: string; command: string; [key: string]: unknown };
type HookGroup = { matcher?: string; hooks: HookCommand[]; [key: string]: unknown };
type HookTable = Record<string, HookGroup[]>;

/** ~/.claude/settings.json の中身。管理キー以外は Claude Code と人間が自由に書く。 */
export type ClaudeSettings = { hooks?: HookTable; [key: string]: unknown };

// ~/.claude/hooks は claude/hooks への symlink。ここを指す hook 登録はすべてこのスクリプトの管理下で、
// 再実行時に一度外してから登録し直す。Claude Code は $HOME をシェルで展開する。
const hooksDirInCommand = "$HOME/.claude/hooks/";

// hook の PATH に mise のツールは無いので、bun は絶対パスで指す。
// このスクリプトを動かしている bun が setup の入れた bun なので、その実パスを使う。
const bunPath = realpathSync(process.execPath);

const hookCommand = (script: string): string => `"${bunPath}" "${hooksDirInCommand}${script}"`;

const managedHooks: HookTable = {
  PreToolUse: [
    {
      matcher: "Edit|Write|MultiEdit|NotebookEdit",
      hooks: [{ type: "command", command: hookCommand("block-main-clone-edit.ts") }],
    },
    {
      matcher: "Bash",
      hooks: [{ type: "command", command: hookCommand("block-irreversible-git.ts") }],
    },
  ],
  WorktreeCreate: [{ hooks: [{ type: "command", command: hookCommand("create-worktree.ts") }] }],
};

// auto memory は PR / Issue の状態を日付つきで溜め、gh から取れる事実より古い前提を残す。
const managedValues: Record<string, unknown> = { autoMemoryEnabled: false };

const isHookCommand = (value: unknown): value is HookCommand =>
  typeof value === "object" && value !== null && typeof (value as HookCommand).command === "string";

const isHookGroup = (value: unknown): value is HookGroup =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as HookGroup).hooks) &&
  (value as HookGroup).hooks.every(isHookCommand);

/**
 * settings.json の hooks が想定の形かを確かめる。
 *
 * 形が違うものをそのまま並べ替えると人間の設定を壊すので、処理せず止める。
 *
 * @param hooks - settings.json の hooks の値。
 * @returns 想定の形なら true。
 */
export const isHookTable = (hooks: unknown): hooks is HookTable =>
  typeof hooks === "object" &&
  hooks !== null &&
  !Array.isArray(hooks) &&
  Object.values(hooks).every((groups) => Array.isArray(groups) && groups.every(isHookGroup));

const isManagedHook = (hook: HookCommand): boolean => hook.command.includes(hooksDirInCommand);

const withoutManagedHooks = (groups: HookGroup[]): HookGroup[] =>
  groups
    .map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !isManagedHook(hook)) }))
    .filter((group) => group.hooks.length > 0);

/**
 * 1 イベント分の hook 登録に、管理対象を加える。
 *
 * 同じ matcher の group が既にあればそこへ足し、無ければ group を追加する。
 *
 * @param existing - settings.json にある登録。
 * @param managed - このリポジトリが管理する登録。
 * @returns 管理対象を外してから足し直した登録。
 */
const mergeGroups = (existing: HookGroup[], managed: HookGroup[]): HookGroup[] => {
  const merged = withoutManagedHooks(existing).map((group) => ({
    ...group,
    hooks: [...group.hooks],
  }));
  for (const group of managed) {
    const target = merged.find((candidate) => candidate.matcher === group.matcher);
    if (target === undefined) {
      merged.push({ ...group, hooks: [...group.hooks] });
    } else {
      target.hooks.push(...group.hooks);
    }
  }
  return merged;
};

/**
 * settings.json に管理キーを書き込んだ結果を返す。
 *
 * 管理キーは hooks の登録(~/.claude/hooks を指すもの)と autoMemoryEnabled だけ。
 * それ以外のキーと、人間が足した hook 登録には触れない。
 *
 * @param current - 現在の settings.json。
 * @returns マージ後の settings.json。
 */
export const mergeSettings = (current: ClaudeSettings): ClaudeSettings => {
  const currentHooks = current.hooks ?? {};
  if (!isHookTable(currentHooks)) {
    throw new Error("settings.json の hooks が想定外の形なので触らない");
  }

  const hooks: HookTable = {};
  const events = new Set([...Object.keys(currentHooks), ...Object.keys(managedHooks)]);
  for (const event of events) {
    const merged = mergeGroups(currentHooks[event] ?? [], managedHooks[event] ?? []);
    if (merged.length > 0) {
      hooks[event] = merged;
    }
  }

  return { ...current, ...managedValues, hooks };
};

const readSettings = async (path: string): Promise<ClaudeSettings> => {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(await Bun.file(path).text());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} がオブジェクトでない`);
  }
  return parsed as ClaudeSettings;
};

const shortenHome = (path: string): string =>
  path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path;

/**
 * ~/.claude/settings.json へ、このリポジトリが管理するキーをマージ書き込みする。
 *
 * settings.json は Claude Code 自身が /config の値を書くため symlink にできない。
 * 端末ローカルの値(model・theme 等)を残したまま管理キーだけを揃え、変化が無ければ書かない。
 */
const runClaudeSettings = async (): Promise<void> => {
  const path = join(homedir(), ".claude", "settings.json");
  const current = await readSettings(path);
  const next = mergeSettings(current);

  if (JSON.stringify(current) === JSON.stringify(next)) {
    console.log(`確認: ${shortenHome(path)}`);
    return;
  }

  // Claude Code も同じファイルを書くので、書きかけの状態を見せないよう一時ファイル経由で置き換える。
  mkdirSync(dirname(path), { recursive: true });
  const stagingPath = `${path}.staging`;
  await Bun.write(stagingPath, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(stagingPath, path);
  console.log(
    `更新: ${shortenHome(path)}(hooks: ${Object.keys(managedHooks).join(", ")} / autoMemoryEnabled: false)`,
  );
};

if (import.meta.main) {
  runClaudeSettings().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

/** Claude Code の hook が stdin で受け取る JSON のうち、このリポジトリの hook が読む項目。 */
export type HookInput = {
  hook_event_name?: string;
  cwd?: string;
  /** WorktreeCreate だけが持つ、新しい worktree の名前。 */
  name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

/**
 * stdin の JSON を読む。
 *
 * @returns 解析した入力。空・壊れた JSON・オブジェクト以外は null(呼び出し側が安全側へ倒す)。
 */
export const readHookInput = async (): Promise<HookInput | null> => {
  const text = await Bun.stdin.text();
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as HookInput) : null;
  } catch {
    return null;
  }
};

/**
 * PreToolUse のツール呼び出しを拒否する決定を stdout へ書く。
 *
 * Claude Code は exit 0 + この JSON を deny として扱い、reason を Claude に見せる。
 *
 * @param reason - Claude に見せる拒否理由。次に取るべき行動まで書く。
 */
export const denyToolUse = (reason: string): void => {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
};

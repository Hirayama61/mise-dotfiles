import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ClaudeSettings, mergeSettings } from "./claude-settings.ts";

const scriptPath = join(import.meta.dir, "claude-settings.ts");

type HookGroup = { matcher?: string; hooks: { command: string }[] };

const groupsOf = (settings: ClaudeSettings, event: string): HookGroup[] =>
  (settings.hooks as Record<string, HookGroup[]>)[event] ?? [];

const commandsOf = (settings: ClaudeSettings, event: string): string[] =>
  groupsOf(settings, event).flatMap((group) => group.hooks.map((hook) => hook.command));

describe("mergeSettings", () => {
  describe("空の settings を受けたとき", () => {
    const merged = mergeSettings({});

    test("PreToolUse に Edit 系 matcher で main clone ブロックを登録する", () => {
      const [group] = groupsOf(merged, "PreToolUse");
      expect(group?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit");
      expect(group?.hooks.map((hook) => hook.command)).toEqual([
        expect.stringContaining('"$HOME/.claude/hooks/block-main-clone-edit.ts"'),
      ]);
    });

    test("PreToolUse に Bash matcher で不可逆な git / gh 操作の遮断を登録する", () => {
      const group = groupsOf(merged, "PreToolUse").find(({ matcher }) => matcher === "Bash");
      expect(group?.hooks.map((hook) => hook.command)).toEqual([
        expect.stringContaining('"$HOME/.claude/hooks/block-irreversible-git.ts"'),
      ]);
    });

    test("WorktreeCreate に gwq ブリッジを登録する", () => {
      expect(commandsOf(merged, "WorktreeCreate")).toEqual([
        expect.stringContaining('"$HOME/.claude/hooks/create-worktree.ts"'),
      ]);
    });

    test("hook コマンドは bun を絶対パスで指す", () => {
      const [command] = commandsOf(merged, "PreToolUse");
      expect(command).toMatch(/^"\/.+" "\$HOME/);
    });

    test("autoMemoryEnabled を false にする", () => {
      expect(merged.autoMemoryEnabled).toBe(false);
    });
  });

  describe("端末ローカルの値と人間の hook 登録がある settings を受けたとき", () => {
    const current: ClaudeSettings = {
      theme: "custom:panda",
      autoMemoryEnabled: true,
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: "/usr/local/bin/my-lint.sh" }],
          },
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: '"/old/bun" "$HOME/.claude/hooks/removed-hook.ts"' },
            ],
          },
        ],
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const merged = mergeSettings(current);

    test("管理キー以外の値はそのまま残す", () => {
      expect(merged.theme).toBe("custom:panda");
      expect(commandsOf(merged, "Stop")).toEqual(["say done"]);
    });

    test("同じ matcher の人間の登録を残し、その後ろに管理対象を足す", () => {
      const [group] = groupsOf(merged, "PreToolUse");
      expect(group?.hooks.map((hook) => hook.command)).toEqual([
        "/usr/local/bin/my-lint.sh",
        expect.stringContaining("block-main-clone-edit.ts"),
      ]);
    });

    test("~/.claude/hooks を指す古い登録は外し、管理対象だけを登録し直す", () => {
      expect(groupsOf(merged, "PreToolUse").map((group) => group.matcher)).toEqual([
        "Edit|Write|MultiEdit|NotebookEdit",
        "Bash",
      ]);
      expect(commandsOf(merged, "PreToolUse")).not.toContainEqual(
        expect.stringContaining("removed-hook.ts"),
      );
    });

    test("autoMemoryEnabled は true でも false に揃える", () => {
      expect(merged.autoMemoryEnabled).toBe(false);
    });

    test("2 回適用しても結果が変わらない", () => {
      expect(mergeSettings(merged)).toEqual(merged);
    });
  });

  describe("hooks が想定外の形のとき", () => {
    test("人間の設定を壊さないよう例外で止める", () => {
      const broken = { hooks: { PreToolUse: "oops" } } as unknown as ClaudeSettings;
      expect(() => mergeSettings(broken)).toThrow("想定外");
    });
  });
});

describe("claude-settings.ts の実行", () => {
  let home = "";
  const settingsPath = (): string => join(home, ".claude", "settings.json");

  const run = (): { stdout: string; stderr: string; exitCode: number | null } => {
    const result = Bun.spawnSync([process.execPath, scriptPath], {
      env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "claude-settings-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  describe("~/.claude/settings.json が無いとき", () => {
    test("ディレクトリごと作り、更新と報告する", () => {
      const { stdout, exitCode } = run();

      expect(exitCode).toBe(0);
      expect(stdout).toInclude("更新: ~/.claude/settings.json");
      const written = JSON.parse(readFileSync(settingsPath(), "utf8")) as ClaudeSettings;
      expect(written.autoMemoryEnabled).toBe(false);
      expect(commandsOf(written, "WorktreeCreate")).toHaveLength(1);
    });
  });

  describe("既に管理キーが揃っているとき", () => {
    test("書き込まず、確認と報告する", () => {
      run();
      const before = readFileSync(settingsPath(), "utf8");

      const { stdout } = run();

      expect(stdout).toInclude("確認: ~/.claude/settings.json");
      expect(readFileSync(settingsPath(), "utf8")).toBe(before);
    });
  });

  describe("settings.json が JSON として壊れているとき", () => {
    test("非ゼロで終わり、ファイルを上書きしない", () => {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(settingsPath(), "{broken");

      const { exitCode } = run();

      expect(exitCode).toBe(1);
      expect(readFileSync(settingsPath(), "utf8")).toBe("{broken");
    });
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findInstalledChrome } from "./agent-browser-chrome.ts";

const scriptPath = join(import.meta.dir, "agent-browser-chrome.ts");

const macChrome =
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const placeFile = (path: string, content = ""): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "agent-browser-chrome-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("findInstalledChrome", () => {
  describe("置き場所が無いとき", () => {
    test("undefined を返す", () => {
      expect(findInstalledChrome(join(workDir, "browsers"))).toBeUndefined();
    });
  });

  describe("版のディレクトリに macOS の Chrome for Testing があるとき", () => {
    test("その実行ファイルのパスを返す", () => {
      const browsersDir = join(workDir, "browsers");
      placeFile(join(browsersDir, "156.0.8078.47", macChrome));

      expect(findInstalledChrome(browsersDir)).toBe(join(browsersDir, "156.0.8078.47", macChrome));
    });
  });

  describe("版のディレクトリはあるが実行ファイルが無いとき", () => {
    test("取得が途中で止まった残骸とみなして undefined を返す", () => {
      const browsersDir = join(workDir, "browsers");
      mkdirSync(join(browsersDir, "156.0.8078.80", "chrome-mac-arm64"), { recursive: true });

      expect(findInstalledChrome(browsersDir)).toBeUndefined();
    });
  });
});

describe("agent-browser-chrome を実行したとき", () => {
  const run = (home: string, binDir: string) =>
    Bun.spawnSync([process.execPath, scriptPath], {
      env: { HOME: home, PATH: binDir },
    });

  const placeFakeAgentBrowser = (binDir: string, exitCode: number): string => {
    const markerPath = join(workDir, "agent-browser-called");
    const fakePath = join(binDir, "agent-browser");
    placeFile(fakePath, `#!/bin/sh\necho "$@" > "${markerPath}"\nexit ${exitCode}\n`);
    chmodSync(fakePath, 0o755);
    return markerPath;
  };

  describe("Chrome for Testing が導入済みの端末では", () => {
    test("agent-browser install を呼ばずに正常終了する", () => {
      const home = join(workDir, "home");
      const binDir = join(workDir, "bin");
      placeFile(join(home, ".agent-browser", "browsers", "156.0.8078.47", macChrome));
      const markerPath = placeFakeAgentBrowser(binDir, 0);

      const result = run(home, binDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(markerPath)).toBe(false);
    });
  });

  describe("Chrome が無く、取得に失敗したとき", () => {
    test("agent-browser install を呼び、警告を出して正常終了する", () => {
      const home = join(workDir, "home");
      const binDir = join(workDir, "bin");
      mkdirSync(home, { recursive: true });
      const markerPath = placeFakeAgentBrowser(binDir, 1);

      const result = run(home, binDir);

      expect(result.exitCode).toBe(0);
      expect(Bun.file(markerPath).size).toBeGreaterThan(0);
      expect(result.stderr.toString()).toContain("警告: Chrome for Testing の取得に失敗した");
    });
  });

  describe("agent-browser が PATH に無いとき", () => {
    test("警告を出して正常終了する", () => {
      const home = join(workDir, "home");
      const binDir = join(workDir, "bin");
      mkdirSync(home, { recursive: true });
      mkdirSync(binDir, { recursive: true });

      const result = run(home, binDir);

      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).toContain("警告: Chrome for Testing の取得に失敗した");
    });
  });
});

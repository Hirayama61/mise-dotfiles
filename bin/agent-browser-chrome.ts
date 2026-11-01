import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// agent-browser install が版ごとのディレクトリの下に置く実行ファイルの相対パス(agent-browser 0.34 の配置)。
const chromeExecutables = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-linux64/chrome",
];

/**
 * agent-browser が使える Chrome for Testing を探す。
 *
 * 版ごとのディレクトリのどれかに実行ファイルがあれば導入済みとみなす。
 * 版の新旧は問わない。agent-browser install は最新 patch を毎回取りに行くため、版の一致では判定しない。
 *
 * @param browsersDir - agent-browser install の置き場所(~/.agent-browser/browsers)。
 * @returns 見つけた実行ファイルのパス。無ければ undefined。
 */
export const findInstalledChrome = (browsersDir: string): string | undefined => {
  if (!existsSync(browsersDir)) {
    return undefined;
  }
  return readdirSync(browsersDir)
    .flatMap((entry) => chromeExecutables.map((executable) => join(browsersDir, entry, executable)))
    .find((path) => existsSync(path));
};

const runInstall = (): boolean => {
  try {
    return Bun.spawnSync(["agent-browser", "install"], { stdout: "inherit", stderr: "inherit" })
      .success;
  } catch {
    // agent-browser が PATH に無いと spawn 自体が投げる。
    return false;
  }
};

/**
 * agent-browser 用の Chrome for Testing を、無いときだけ取りに行く。
 *
 * 取得の失敗は警告に留めて正常終了する。bootstrap の後段や setup の完了を Chrome のダウンロードで止めないため。
 */
const runAgentBrowserChrome = (): void => {
  const installed = findInstalledChrome(join(homedir(), ".agent-browser", "browsers"));
  if (installed !== undefined) {
    console.log(`確認: Chrome for Testing(${installed})`);
    return;
  }
  if (!runInstall()) {
    console.warn(
      "警告: Chrome for Testing の取得に失敗した。ネットワークを確かめて `agent-browser install` を実行する",
    );
  }
};

if (import.meta.main) {
  runAgentBrowserChrome();
}

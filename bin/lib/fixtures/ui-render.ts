import { createUi } from "../ui.ts";

/**
 * 対話しない表示部品を一通り描画する。
 *
 * ui.test.ts が stdout をパイプした子プロセスとして実行し、
 * 端末以外へ出力した時の見た目を検証する。
 */
const runUiRenderFixture = async (): Promise<void> => {
  const ui = await createUi();
  ui.section("ツール");
  ui.status("ok", "gh", "2.62.0");
  ui.status("kept", "user.name", "octocat");
  ui.note("補足の 1 行");
  ui.nextStep("mise run setup", "ツールと設定を適用する");
  ui.nextStep("very-long-command-over-24-columns", "説明");
  ui.ready("準備完了");
  ui.close();
};

if (import.meta.main) {
  await runUiRenderFixture();
}

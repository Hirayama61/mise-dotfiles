import { createUi } from "../ui.ts";

/**
 * ask と confirm を 1 回ずつ実行し、結果を JSON で最終行に出力する。
 *
 * ui.test.ts が stdin をパイプした子プロセスとして実行する。
 * ask が EOF で中断した場合は error を出力する。
 */
const runUiDialogFixture = async (): Promise<void> => {
  const ui = await createUi();
  try {
    const answer = await ui.ask("name", "DEF");
    const confirmed = await ui.confirm("よろしいですか");
    console.log(JSON.stringify({ answer, confirmed }));
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  } finally {
    ui.close();
  }
};

if (import.meta.main) {
  await runUiDialogFixture();
}

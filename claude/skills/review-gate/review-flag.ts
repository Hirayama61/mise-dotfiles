import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  type ReviewFlag,
  assessRisk,
  flagPath,
  hasApproval,
  resolvePushDiff,
  reviewCommand,
} from "../../hooks/lib/review-gate.ts";

const usage = [
  "使い方:",
  "  review-flag.ts status",
  "  review-flag.ts approve --fingerprint <status の fingerprint> --engine <名前> --effort <effort>",
].join("\n");

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

/**
 * 現在の push 差分の fingerprint・risk・案内する `/code-review`・承認状況を JSON で出す。
 *
 * @param dir - git の作業ディレクトリ。
 */
const printStatus = async (dir: string): Promise<void> => {
  const diff = resolvePushDiff(dir);
  if (diff === null) {
    console.log(JSON.stringify({ pushable_diff: false }, null, 2));
    return;
  }
  const risk = assessRisk(diff.files, diff.changedLines);
  const path = flagPath(dir, diff.fingerprint);
  const approved = path !== null && (await hasApproval(path, diff.fingerprint));
  console.log(
    JSON.stringify(
      {
        pushable_diff: true,
        base_ref: diff.baseRef,
        base: diff.base,
        fingerprint: diff.fingerprint,
        files: diff.files,
        changed_lines: diff.changedLines,
        risk: risk.level,
        reasons: risk.reasons,
        review_command: reviewCommand(risk.effort, diff.base),
        approved,
      },
      null,
      2,
    ),
  );
};

/**
 * 承認した差分の flag を書く。
 *
 * レビュー前に status で控えた fingerprint を受け取り、今の差分と一致するときだけ書く。
 * レビュー後に差分が変わっていれば、未レビューの差分を承認しないよう失敗させる。
 *
 * @param dir - git の作業ディレクトリ。
 * @param fingerprint - レビュー前に status で得た fingerprint。
 * @param engine - レビューしたエンジンの名前。記録用。
 * @param effort - レビューの effort。記録用。
 */
const approve = async (
  dir: string,
  fingerprint: string,
  engine: string,
  effort: string,
): Promise<void> => {
  const diff = resolvePushDiff(dir) ?? fail("push で送る差分が無い。flag は要らない。");
  if (diff.fingerprint !== fingerprint) {
    fail(
      [
        "レビューした fingerprint と今の差分が一致しない。レビュー後に差分が変わっている。",
        `レビュー時: ${fingerprint}`,
        `現在: ${diff.fingerprint}`,
        "status からやり直し、変わった差分をレビューする。",
      ].join("\n"),
    );
  }
  const path = flagPath(dir, fingerprint) ?? fail("git の共通ディレクトリが分からない。");
  const flag = {
    schema_version: 1,
    engine,
    effort,
    reviewed_diff_fingerprint: fingerprint,
    approved: true,
    reviewed_at: new Date().toISOString(),
  } satisfies ReviewFlag;
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(flag, null, 2)}\n`);
  console.log(`flag を書いた: ${path}`);
};

/**
 * review-gate skill が使う、push 差分の状態確認と review flag の発行。
 *
 * カレントディレクトリのリポジトリを対象にする。flag の検証は hook(review-gate.ts)が行う。
 */
const runReviewFlag = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      fingerprint: { type: "string" },
      engine: { type: "string" },
      effort: { type: "string" },
    },
  });
  const dir = process.cwd();
  const [subcommand] = positionals;
  if (subcommand === "status") {
    await printStatus(dir);
    return;
  }
  if (subcommand === "approve") {
    const { fingerprint, engine, effort } = values;
    if (fingerprint === undefined || engine === undefined || effort === undefined) {
      fail(usage);
      return;
    }
    await approve(dir, fingerprint, engine, effort);
    return;
  }
  fail(usage);
};

if (import.meta.main) {
  await runReviewFlag();
}

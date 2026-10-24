import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { git } from "./git.ts";

export type RiskLevel = "low" | "medium" | "high";

/** risk 判定の規則 1 件。パスのどこか 1 つでも合えば、その level 以上と判定する。 */
export type RiskRule = { level: RiskLevel; label: string; pattern: RegExp };

/** push で remote へ送られるコミットの差分。 */
export type PushDiff = {
  /** 差分の起点。upstream または既定ブランチと HEAD の merge-base。 */
  base: string;
  /** base を求めた ref の名前。 */
  baseRef: string;
  fingerprint: string;
  files: string[];
  changedLines: number;
};

export type RiskAssessment = {
  level: RiskLevel;
  /** 人間に案内する `/code-review` の effort。 */
  effort: string;
  /** 判定の根拠。規則の名前と該当したファイル。 */
  reasons: string[];
};

/**
 * review flag。push gate はレビューエンジンを知らず、
 * reviewed_diff_fingerprint が承認済みかだけを見る。engine と effort は記録用。
 */
export type ReviewFlag = {
  schema_version: 1;
  engine: string;
  effort: string;
  reviewed_diff_fingerprint: string;
  approved: boolean;
  reviewed_at: string;
};

// 案内用の分類で、品質の判断は /code-review に任せる。パスの宣言だけで決め、内容は読まない。
export const riskRules: readonly RiskRule[] = [
  {
    level: "high",
    label: "認証",
    pattern:
      /(^|\/)(auth|authn|authz|authentication|authorization|oauth2?|login|logout|sign-?in|sign-?up|sessions?|jwt|passwords?|credentials?)([._-][^/]*)?(\/|$)/i,
  },
  {
    level: "high",
    label: "migration・スキーマ",
    pattern: /(^|\/)(migrations?|migrate)\/|(^|\/)schema\.(rb|prisma|sql|graphql)$|\.sql$/i,
  },
  {
    level: "high",
    label: "権限",
    pattern:
      /(^|\/)(permissions?|rbac|acl|polic(y|ies)|roles?|guards?)([._-][^/]*)?(\/|$)|(^|\/)\.claude\/settings[^/]*\.json$/i,
  },
  {
    level: "high",
    label: "CI 設定",
    pattern: /^\.github\/(workflows|actions)\/|^\.gitlab-ci\.yml$|^\.circleci\//,
  },
  {
    level: "high",
    label: "秘密情報",
    pattern: /(^|\/)(\.env[^/]*|secrets?([._-][^/]*)?)(\/|$)|\.(pem|key|p12)$/i,
  },
  {
    level: "medium",
    label: "依存",
    pattern:
      /(^|\/)(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|pyproject\.toml|uv\.lock|poetry\.lock|requirements[^/]*\.txt)$/,
  },
];

// これを超える行数の差分は、パスに関係なく medium 以上にする。
export const largeDiffLines = 400;

const levelOrder: readonly RiskLevel[] = ["low", "medium", "high"];

const effortByLevel: Record<RiskLevel, string> = { low: "low", medium: "medium", high: "high" };

// 1 つの規則が根拠に挙げるファイル数の上限。多すぎる列挙は deny の文面を埋める。
const reasonFileLimit = 3;

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const higher = (a: RiskLevel, b: RiskLevel): RiskLevel =>
  levelOrder.indexOf(a) >= levelOrder.indexOf(b) ? a : b;

/**
 * 変更ファイルと行数から risk を判定する。
 *
 * @param files - 変更ファイル(リポジトリルートからの相対パス)。
 * @param changedLines - 追加と削除の行数の合計。
 * @returns 規則のうち最も高い level と、それに対応する effort。
 */
export const assessRisk = (files: readonly string[], changedLines: number): RiskAssessment => {
  let level: RiskLevel = "low";
  const reasons: string[] = [];
  for (const rule of riskRules) {
    const matched = files.filter((file) => rule.pattern.test(file));
    if (matched.length > 0) {
      level = higher(level, rule.level);
      const shown = matched.slice(0, reasonFileLimit).join(", ");
      const rest =
        matched.length > reasonFileLimit ? ` ほか ${matched.length - reasonFileLimit} 件` : "";
      reasons.push(`${rule.label}(${rule.level}): ${shown}${rest}`);
    }
  }
  if (changedLines > largeDiffLines) {
    level = higher(level, "medium");
    reasons.push(`大きな差分(medium): ${changedLines} 行`);
  }
  return { level, effort: effortByLevel[level], reasons };
};

/**
 * 案内する `/code-review` のコマンドを組み立てる。対象を push の差分に固定する。
 *
 * @param effort - `/code-review` の effort。
 * @param base - 差分の起点のコミット。
 * @returns 人間がプロンプトに打つコマンド。
 */
export const reviewCommand = (effort: string, base: string): string =>
  `/code-review ${effort} ${base.slice(0, 12)}..HEAD`;

/**
 * flag の内容がこの fingerprint の承認になっているかを判定する。
 *
 * @param flag - flag ファイルを JSON として読んだ値。
 * @param fingerprint - push しようとしている差分の fingerprint。
 * @returns 承認済みなら true。形が違うものは承認とみなさない。
 */
export const isApprovalOf = (flag: unknown, fingerprint: string): boolean => {
  if (typeof flag !== "object" || flag === null) {
    return false;
  }
  return (
    "schema_version" in flag &&
    flag.schema_version === 1 &&
    "approved" in flag &&
    flag.approved === true &&
    "reviewed_diff_fingerprint" in flag &&
    flag.reviewed_diff_fingerprint === fingerprint
  );
};

/**
 * push で送られるコミットの差分を求める。
 *
 * 起点は upstream があればそれ、無ければ origin の既定ブランチ(origin/HEAD・main・master の順)との
 * merge-base。作業ツリーの未コミットの変更は push されないので含めない。
 *
 * @param dir - git の作業ディレクトリ。
 * @returns 差分。git 外・起点不明・送るコミットが無いときは null。
 */
export const resolvePushDiff = (dir: string): PushDiff | null => {
  const candidates = [
    git(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
    "origin/main",
    "origin/master",
  ];
  for (const ref of candidates) {
    if (ref === null || ref === "") {
      continue;
    }
    const base = git(dir, ["merge-base", ref, "HEAD"]);
    if (base === null) {
      continue;
    }
    // 利用者の diff 設定で出力が揺れないよう、外部 diff・textconv・rename 検出を切る。
    const diffArgs = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];
    const patch = git(dir, [...diffArgs, "--binary", "--full-index", base, "HEAD"]);
    const numstat = git(dir, [...diffArgs, "--numstat", base, "HEAD"]);
    if (patch === null || numstat === null || patch === "") {
      return null;
    }
    const rows = numstat.split("\n").map((line) => line.split("\t"));
    // バイナリは行数が `-` になるので 0 として数える。
    const changedLines = rows.reduce(
      (sum, [added, deleted]) => sum + (Number(added) || 0) + (Number(deleted) || 0),
      0,
    );
    const files = rows.map((columns) => columns.slice(2).join("\t"));
    return { base, baseRef: ref, fingerprint: sha256(patch), files, changedLines };
  }
  return null;
};

/**
 * flag ファイルの置き場所を返す。
 *
 * リポジトリ外の `$XDG_STATE_HOME/claude-review-gate/<repo key>/` に置く。
 * repo key は git の共通ディレクトリから作るので、同じリポジトリの worktree 間で共有される。
 *
 * @param dir - git の作業ディレクトリ。
 * @param fingerprint - 差分の fingerprint。
 * @returns flag ファイルのパス。git 外なら null。
 */
export const flagPath = (dir: string, fingerprint: string): string | null => {
  const commonDir = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDir === null || commonDir === "") {
    return null;
  }
  let resolved: string;
  try {
    resolved = realpathSync(commonDir);
  } catch {
    return null;
  }
  const repoName = basename(resolved) === ".git" ? basename(dirname(resolved)) : basename(resolved);
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const repoKey = `${repoName}-${sha256(resolved).slice(0, 12)}`;
  return join(stateHome, "claude-review-gate", repoKey, `${fingerprint}.json`);
};

/**
 * 差分が承認済みかを flag ファイルで確かめる。
 *
 * @param path - flag ファイルのパス。
 * @param fingerprint - push しようとしている差分の fingerprint。
 * @returns 承認済みなら true。ファイルが無い・壊れているときは false。
 */
export const hasApproval = async (path: string, fingerprint: string): Promise<boolean> => {
  try {
    return isApprovalOf(await Bun.file(path).json(), fingerprint);
  } catch {
    return false;
  }
};

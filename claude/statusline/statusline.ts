import { loadPalette, type Rgb } from "../../bin/lib/palette.ts";

/** レートリミット 1 窓分の使用状況。 */
export type RateWindow = {
  usedPercentage: number;
  /** リセット時刻(epoch 秒)。無ければ残り時間を出さない。 */
  resetsAt?: number;
};

/** open PR の表示に使う項目。 */
export type PullRequest = {
  number: number;
  url?: string;
  reviewState?: string;
};

/** ステータスラインに出す情報。無い項目の区画は描画しない。 */
export type StatusLineState = {
  model?: string;
  contextPercentage?: number;
  fiveHour?: RateWindow;
  sevenDay?: RateWindow;
  branch?: string;
  /** linked worktree の名前。main clone では無い。 */
  worktree?: string;
  pr?: PullRequest;
};

/** stdin JSON から読み取った情報。ブランチは JSON に無いので git で補う。 */
export type StatusLineInput = Omit<StatusLineState, "branch"> & { cwd?: string };

/** 使用率のグラデーションに使う 3 色と、補助の文字色。 */
export type StatusLineColors = { mint: Rgb; orange: Rgb; red: Rgb; subtle: Rgb };

/** 描画の条件。 */
export type RenderOptions = {
  /** 残り時間の基準にする現在時刻(epoch 秒)。 */
  now: number;
  /** null なら ANSI カラーと OSC 8 リンクを出さない。 */
  colors: StatusLineColors | null;
  /** 端末の桁数。null なら折り返さず 1 行で出す。 */
  columns: number | null;
};

const braille = [" ", "⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿"] as const;
const barWidth = 8;

const dim = "\u001B[2m";
const reset = "\u001B[0m";
const separator = " │ ";

const gitBin = Bun.which("git") ?? "/usr/bin/git";
const gitTimeoutMs = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordAt = (value: unknown, key: string): Record<string, unknown> | undefined => {
  const child = isRecord(value) ? value[key] : undefined;
  return isRecord(child) ? child : undefined;
};

const stringAt = (value: unknown, key: string): string | undefined => {
  const child = isRecord(value) ? value[key] : undefined;
  return typeof child === "string" && child !== "" ? child : undefined;
};

const numberAt = (value: unknown, key: string): number | undefined => {
  const child = isRecord(value) ? value[key] : undefined;
  return typeof child === "number" && Number.isFinite(child) ? child : undefined;
};

const rateWindowAt = (rateLimits: unknown, key: string): RateWindow | undefined => {
  const window = recordAt(rateLimits, key);
  const usedPercentage = numberAt(window, "used_percentage");
  if (usedPercentage === undefined) {
    return undefined;
  }
  return { usedPercentage, resetsAt: numberAt(window, "resets_at") };
};

const pullRequestAt = (value: unknown): PullRequest | undefined => {
  const pr = recordAt(value, "pr");
  const number = numberAt(pr, "number");
  if (number === undefined) {
    return undefined;
  }
  return { number, url: stringAt(pr, "url"), reviewState: stringAt(pr, "review_state") };
};

/**
 * Claude Code がステータスラインへ渡す stdin JSON から、表示に使う項目を取り出す。
 *
 * 項目は欠けることがある(rate_limits は Pro / Max の初回応答後だけ、pr は open PR があるときだけ)。
 * 型の合わない値も欠けた扱いにする。
 *
 * @param json - JSON.parse した stdin。
 * @returns 取り出せた項目。オブジェクトでなければ空。
 */
export const parseStatusLineInput = (json: unknown): StatusLineInput => {
  const workspace = recordAt(json, "workspace");
  const rateLimits = recordAt(json, "rate_limits");
  return {
    model: stringAt(recordAt(json, "model"), "display_name"),
    contextPercentage: numberAt(recordAt(json, "context_window"), "used_percentage"),
    fiveHour: rateWindowAt(rateLimits, "five_hour"),
    sevenDay: rateWindowAt(rateLimits, "seven_day"),
    worktree: stringAt(workspace, "git_worktree"),
    pr: pullRequestAt(json),
    cwd: stringAt(workspace, "current_dir") ?? stringAt(json, "cwd"),
  };
};

const clampPercentage = (percentage: number): number => Math.min(100, Math.max(0, percentage));

const lerp = (from: Rgb, to: Rgb, ratio: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * ratio),
  Math.round(from[1] + (to[1] - from[1]) * ratio),
  Math.round(from[2] + (to[2] - from[2]) * ratio),
];

/**
 * 使用率に対応するグラデーションの色を返す。
 *
 * 0〜50% は mint → orange、50〜80% は orange → red、80% 以上は red。
 *
 * @param percentage - 使用率。0〜100 の外は端に寄せる。
 * @param colors - palette.sh から読んだ色。
 * @returns 補間した RGB。
 */
export const usageColor = (percentage: number, colors: StatusLineColors): Rgb => {
  const clamped = clampPercentage(percentage);
  if (clamped <= 50) {
    return lerp(colors.mint, colors.orange, clamped / 50);
  }
  if (clamped <= 80) {
    return lerp(colors.orange, colors.red, (clamped - 50) / 30);
  }
  return colors.red;
};

/**
 * 使用率を Braille 文字のバーにする。1 文字が 7 段階を持つ。
 *
 * @param percentage - 使用率。0〜100 の外は端に寄せる。
 * @returns 8 文字のバー。
 */
export const brailleBar = (percentage: number): string => {
  const steps = braille.length - 1;
  const filled = (clampPercentage(percentage) / 100) * barWidth * steps;
  return Array.from({ length: barWidth }, (_, index) => {
    const level = Math.min(steps, Math.max(0, Math.floor(filled - index * steps)));
    return braille[level];
  }).join("");
};

/**
 * リセットまでの残り時間を短く書く。
 *
 * @param resetsAt - リセット時刻(epoch 秒)。
 * @param now - 現在時刻(epoch 秒)。
 * @returns 1 日以上は `2d8h`、1 時間以上は `3h05m`、それ未満は `45m`。過ぎていれば `0m`。
 */
export const formatTimeUntil = (resetsAt: number, now: number): string => {
  const seconds = Math.max(0, Math.floor(resetsAt - now));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
};

const foreground = ([red, green, blue]: Rgb): string => `\u001B[38;2;${red};${green};${blue}m`;

const paint = (text: string, color: Rgb, colors: StatusLineColors | null): string =>
  colors === null ? text : `${foreground(color)}${text}${reset}`;

const faint = (text: string, colors: StatusLineColors | null): string =>
  colors === null ? text : `${dim}${text}${reset}`;

const link = (text: string, url: string | undefined, colors: StatusLineColors | null): string =>
  colors === null || url === undefined ? text : `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;

const usageSection = (
  label: string,
  percentage: number,
  options: RenderOptions,
  resetsAt?: number,
): string => {
  const { colors } = options;
  const bar =
    colors === null
      ? brailleBar(percentage)
      : paint(brailleBar(percentage), usageColor(percentage, colors), colors);
  const remaining = resetsAt === undefined ? "" : ` ${formatTimeUntil(resetsAt, options.now)}`;
  return `${faint(label, colors)} ${bar} ${Math.round(percentage)}%${remaining}`;
};

const reviewStateColor = (state: string, colors: StatusLineColors): Rgb => {
  switch (state) {
    case "approved":
      return colors.mint;
    case "changes_requested":
      return colors.red;
    case "pending":
      return colors.orange;
    default:
      return colors.subtle;
  }
};

const pullRequestSection = (pr: PullRequest, colors: StatusLineColors | null): string => {
  const number = link(`#${pr.number}`, pr.url, colors);
  if (pr.reviewState === undefined) {
    return `${faint("PR", colors)} ${number}`;
  }
  const state =
    colors === null
      ? pr.reviewState
      : paint(pr.reviewState, reviewStateColor(pr.reviewState, colors), colors);
  return `${faint("PR", colors)} ${number} ${state}`;
};

const sectionsOf = (state: StatusLineState, options: RenderOptions): string[] => {
  const { colors } = options;
  const sections: (string | undefined)[] = [
    state.model,
    state.contextPercentage === undefined
      ? undefined
      : usageSection("ctx", state.contextPercentage, options),
    state.fiveHour === undefined
      ? undefined
      : usageSection("5h", state.fiveHour.usedPercentage, options, state.fiveHour.resetsAt),
    state.sevenDay === undefined
      ? undefined
      : usageSection("7d", state.sevenDay.usedPercentage, options, state.sevenDay.resetsAt),
    state.branch === undefined ? undefined : `${faint("⎇", colors)} ${state.branch}`,
    state.worktree === undefined ? undefined : `${faint("wt", colors)} ${state.worktree}`,
    state.pr === undefined ? undefined : pullRequestSection(state.pr, colors),
  ];
  return sections.filter((section) => section !== undefined);
};

/**
 * 区画を区切り文字で並べ、端末幅を超える手前で次の行へ送る。
 *
 * 1 区画が幅を超えるときはその区画だけで 1 行にする(区画の途中では切らない)。
 */
const wrapSections = (
  sections: readonly string[],
  joint: string,
  columns: number | null,
): string[] => {
  const lines: string[] = [];
  let current = "";
  for (const section of sections) {
    const candidate = current === "" ? section : `${current}${joint}${section}`;
    if (columns === null || current === "" || Bun.stringWidth(candidate) <= columns) {
      current = candidate;
    } else {
      lines.push(current);
      current = section;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
};

/**
 * ステータスラインの文字列を組み立てる。
 *
 * @param state - 表示する情報。
 * @param options - 現在時刻・配色・端末幅。
 * @returns stdout へそのまま書く文字列。複数行は改行で区切る。
 */
export const renderStatusLine = (state: StatusLineState, options: RenderOptions): string =>
  wrapSections(sectionsOf(state, options), faint(separator, options.colors), options.columns).join(
    "\n",
  );

const paletteColors = async (): Promise<StatusLineColors | null> => {
  const palette = await loadPalette();
  const mint = palette.get("MINT");
  const orange = palette.get("ORANGE");
  const red = palette.get("RED");
  const subtle = palette.get("SUBTLE");
  if (mint === undefined || orange === undefined || red === undefined || subtle === undefined) {
    return null;
  }
  return { mint, orange, red, subtle };
};

// ステータスラインは更新のたびに走り、次の更新が来ると中断される。
// git の index ロックを取らず(--no-optional-locks)、遅いリポジトリでも短時間で諦める。
const git = (cwd: string, args: readonly string[]): string | undefined => {
  try {
    const result = Bun.spawnSync([gitBin, "--no-optional-locks", "-C", cwd, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: gitTimeoutMs,
    });
    const output = result.stdout.toString().trim();
    return result.success && output !== "" ? output : undefined;
  } catch {
    return undefined;
  }
};

// symbolic-ref はコミット前のブランチでも名前を返す。detached HEAD では短縮 SHA を出す。
const currentBranch = (cwd: string | undefined): string | undefined =>
  cwd === undefined
    ? undefined
    : (git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]) ??
      git(cwd, ["rev-parse", "--short", "HEAD"]));

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const terminalColumns = (): number | null => {
  const columns = Number(process.env.COLUMNS);
  return Number.isInteger(columns) && columns > 0 ? columns : null;
};

/**
 * Claude Code のステータスラインを描画する。
 *
 * stdin の JSON からモデル・コンテキスト使用率・5h / 7d レートリミット・worktree・PR を、
 * git から現在ブランチを取り、Panda 配色で 1 行(幅が足りなければ複数行)にして stdout へ書く。
 * stdin が JSON でなくても 0 で終わる。終了コードが非ゼロだと Claude Code は何も表示しない。
 * NO_COLOR が空でなければ色とリンクを付けない。
 */
const runStatusLine = async (): Promise<void> => {
  const json = parseJson(await Bun.stdin.text());
  if (!isRecord(json)) {
    console.log("statusline: stdin が JSON オブジェクトでない");
    return;
  }

  const { cwd, ...input } = parseStatusLineInput(json);
  const branch = currentBranch(cwd);
  const noColor = (process.env.NO_COLOR ?? "") !== "";
  const output = renderStatusLine(branch === undefined ? input : { ...input, branch }, {
    now: Date.now() / 1000,
    colors: noColor ? null : await paletteColors().catch(() => null),
    columns: terminalColumns(),
  });
  console.log(output);
};

if (import.meta.main) {
  runStatusLine().catch((error: unknown) => {
    // 描画に失敗しても終了コードは 0 にし、原因を 1 行で見せる。
    console.log(`statusline: ${error instanceof Error ? error.message : String(error)}`);
  });
}

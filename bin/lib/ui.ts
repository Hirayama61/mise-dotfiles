import { loadPalette, type Rgb } from "./palette.ts";

/** ステータス行の状態。ok は揃っている、kept は既存があるので触らなかった。 */
export type UiState = "ok" | "kept";

/** この UI が使う Panda 配色の色名。palette.sh の PANDA_ 接頭辞を除いた名前。 */
export type PaletteColorName =
  | "FG"
  | "SUBTLE"
  | "GRAY_LIFT"
  | "MINT"
  | "PINK"
  | "CYAN"
  | "PURPLE_LIFT"
  | "BLUE_LIFT";

/**
 * TypeScript タスクの表示と対話の部品。ui.sh と同じ見た目を提供する。
 */
export type Ui = {
  /** 色を付けた文字列を返す。色を使わない出力先ではそのまま返す。 */
  paint: (color: PaletteColorName, text: string) => string;
  banner: (subtitle: string) => void;
  section: (title: string) => void;
  status: (state: UiState, label: string, detail: string) => void;
  note: (text: string) => void;

  /**
   * 時間のかかるコマンドをスピナーで隠して実行する。失敗した時だけログを吐き出す。
   * 標準入出力を奪うので、対話が必要なコマンドには使えない。
   */
  run: (label: string, detail: string, command: readonly string[]) => Promise<void>;

  /** 1 行の入力を求める。空 Enter は既定値を返す。EOF は入力を得られないので中断する。 */
  ask: (label: string, defaultValue: string) => Promise<string>;

  /** Yes/No を尋ねる。空 Enter は Yes、EOF は「答えられなかった」として No。 */
  confirm: (question: string) => Promise<boolean>;
  ready: (text: string) => void;
  nextStep: (commandText: string, description: string) => void;

  /** pbcopy があればコマンドをクリップボードへ入れる。無い環境では何もしない。 */
  clipboard: (commandText: string) => void;

  /** スピナー中断でカーソルが消えたままにならないよう、終了時に呼ぶ。 */
  showCursor: () => void;

  /** 対話用に開いた標準入力を閉じる。呼ばないとプロセスが終了しない。 */
  close: () => void;
};

const spinnerFrames = [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"];

const write = (text: string): void => {
  process.stdout.write(text);
};

/**
 * UI を初期化する。配色は palette.sh から読み込む。
 *
 * 端末以外へ出力する時と NO_COLOR 指定時はエスケープを出さない。
 * ログやパイプに制御文字が混ざると読めなくなるため。
 *
 * @returns 表示と対話の部品一式。
 */
export const createUi = async (): Promise<Ui> => {
  const palette = await loadPalette();
  const usesColor = process.stdout.isTTY === true && (process.env.NO_COLOR ?? "") === "";

  // 出力が一度に流れると目線が追いつかないので、行ごとに間を置く。
  // 0 を渡せば止まらない。端末以外へ出力する時は元から待たない。
  const configuredDelay = Number(process.env.UI_LINE_DELAY ?? "0.06");
  const lineDelayMs = (Number.isFinite(configuredDelay) ? configuredDelay : 0.06) * 1000;

  const rgb = (color: PaletteColorName): Rgb => {
    const value = palette.get(color);
    if (value === undefined) {
      throw new Error(`palette.sh に PANDA_${color} が定義されていない`);
    }
    return value;
  };

  const colorCode = ([red, green, blue]: Rgb): string => `\x1b[38;2;${red};${green};${blue}m`;
  const reset = usesColor ? "\x1b[0m" : "";

  const paint = (color: PaletteColorName, text: string): string =>
    usesColor ? `${colorCode(rgb(color))}${text}${reset}` : text;

  const pauseLine = (): void => {
    if (usesColor && lineDelayMs > 0) {
      Bun.sleepSync(lineDelayMs);
    }
  };

  // 1 文字ずつ色を送って左右にグラデーションをかける。
  const gradient = (text: string, from: Rgb, to: Rgb): string => {
    if (!usesColor) {
      return text;
    }

    const chars = [...text];
    const last = Math.max(chars.length - 1, 1);
    const colored = chars.map((char, index) => {
      const mix = (start: number, end: number): number =>
        Math.trunc(start + ((end - start) * index) / last);
      const [red, green, blue] = [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
      return `\x1b[38;2;${red};${green};${blue}m${char}`;
    });
    return `${colored.join("")}${reset}`;
  };

  const banner = (subtitle: string): void => {
    write(
      `\n  ${gradient("┏┳┓╻┏━┓┏━╸   ╺┳┓┏━┓╺┳╸┏━╸╻╻  ┏━╸┏━┓", rgb("PINK"), rgb("PURPLE_LIFT"))}`,
    );
    pauseLine();
    write(
      `\n  ${gradient("┃┃┃┃┗━┓┣╸     ┃┃┃ ┃ ┃ ┣╸ ┃┃  ┣╸ ┗━┓", rgb("PURPLE_LIFT"), rgb("BLUE_LIFT"))}`,
    );
    pauseLine();
    write(`\n  ${gradient("╹ ╹╹┗━┛┗━╸   ╺┻┛┗━┛ ╹ ╹  ╹┗━╸┗━╸┗━┛", rgb("BLUE_LIFT"), rgb("MINT"))}`);
    pauseLine();
    write("\n\n");
    write(`${paint("GRAY_LIFT", `  ${subtitle}`)}\n\n`);
    pauseLine();
  };

  const section = (title: string): void => {
    write(`\n${paint("SUBTLE", `   ${title}`)}\n\n`);
    pauseLine();
  };

  const status = (state: UiState, label: string, detail: string): void => {
    const marker = state === "ok" ? paint("MINT", "✓ ") : paint("SUBTLE", "· ");
    write(`   ${marker}${paint("FG", label.padEnd(14))}${paint("GRAY_LIFT", detail)}\n`);
    pauseLine();
  };

  const note = (text: string): void => {
    write(`${paint("GRAY_LIFT", `   ${text}`)}\n`);
    pauseLine();
  };

  const showCursor = (): void => {
    if (usesColor) {
      write("\x1b[?25h");
    }
  };

  const run = async (label: string, detail: string, command: readonly string[]): Promise<void> => {
    if (!usesColor) {
      const plain = Bun.spawnSync([...command], { stdout: "inherit", stderr: "inherit" });
      if (!plain.success) {
        throw new Error(`${command.join(" ")} が失敗した`);
      }
      return;
    }

    const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
    // 読み出しを止めるとパイプが詰まって子プロセスが止まるので、終了を待つ前に読み始める。
    const stdoutText = new Response(child.stdout).text();
    const stderrText = new Response(child.stderr).text();

    write("\x1b[?25l");
    let frame = 0;
    const render = (): void => {
      const mark = spinnerFrames[frame % spinnerFrames.length] ?? "";
      write(
        `\r   ${paint("MINT", mark)} ${paint("FG", label.padEnd(14))}${paint("GRAY_LIFT", detail)}`,
      );
      frame += 1;
    };
    render();
    const timer = setInterval(render, 100);

    const exitCode = await child.exited;
    clearInterval(timer);
    write("\r\x1b[K");
    showCursor();

    if (exitCode !== 0) {
      process.stderr.write(`${await stdoutText}${await stderrText}`);
      throw new Error(`${command.join(" ")} が失敗した`);
    }
  };

  // node:readline は Bun だと 2 問目以降の question が返らないため、
  // Bun ネイティブの console の行イテレータで読む。イテレータを作り直すと
  // バッファ済みの入力を取りこぼすので、1 本を使い回す。
  let stdinLines: AsyncIterator<string> | null = null;
  const readLine = async (): Promise<string | null> => {
    stdinLines ??= console[Symbol.asyncIterator]();
    const next = await stdinLines.next();
    return next.done === true ? null : next.value.trim();
  };

  const ask = async (label: string, defaultValue: string): Promise<string> => {
    write(
      paint("FG", `   ${label.padEnd(8)}`) +
        paint("SUBTLE", `[${defaultValue}] `) +
        paint("CYAN", "> "),
    );
    const answer = await readLine();
    if (answer === null) {
      throw new Error("入力が閉じられたため中断した");
    }
    write("\n");
    return answer === "" ? defaultValue : answer;
  };

  const confirm = async (question: string): Promise<boolean> => {
    write(paint("PINK", `   ${question} `) + paint("SUBTLE", "[Y/n] "));
    const answer = await readLine();
    // EOF は「答えられなかった」であって Yes ではない。空 Enter とは区別する。
    if (answer === null) {
      return false;
    }
    return answer === "" || answer.toLowerCase().startsWith("y");
  };

  const ready = (text: string): void => {
    write(`\n${paint("MINT", "   ready.")}${paint("GRAY_LIFT", `  ${text}`)}\n\n`);
    pauseLine();
  };

  // コマンドが 24 桁に収まらないと説明が直に続いて読めなくなるので、
  // 桁が足りない時も最低 2 つは空ける。
  const nextStep = (commandText: string, description: string): void => {
    const padding = Math.max(24 - commandText.length, 2);
    write(
      `     ${paint("CYAN", commandText)}${" ".repeat(padding)}${paint("SUBTLE", description)}\n`,
    );
    pauseLine();
  };

  const clipboard = (commandText: string): void => {
    if (Bun.which("pbcopy") === null) {
      return;
    }
    Bun.spawnSync(["pbcopy"], { stdin: new TextEncoder().encode(`${commandText}\n`) });
    write(`   ${paint("PINK", "📋 ")}${paint("GRAY_LIFT", "クリップボードに入れました")}\n`);
    pauseLine();
  };

  const close = (): void => {
    void stdinLines?.return?.();
  };

  return {
    paint,
    banner,
    section,
    status,
    note,
    run,
    ask,
    confirm,
    ready,
    nextStep,
    clipboard,
    showCursor,
    close,
  };
};

type RedirectTarget = "drop" | "heredoc" | "heredoc-dash";

type Heredoc = {
  delimiter: string;
  stripTabs: boolean;
  /** 区切り語にクォートが無く、本文のコマンド置換が実行されるか。 */
  expands: boolean;
};

/** 単純コマンド 1 つ。 */
export type SimpleCommand = {
  words: string[];
  /**
   * 囲んでいるサブシェル・コマンド置換の経路。外側から順に、出現ごとに振った番号を並べる。
   *
   * サブシェル内の cd は外へ漏れないので、cd の効く範囲を経路の接頭辞で判定する。
   */
  scope: readonly number[];
};

type Terminator = ")" | "`" | null;

/** コマンド全体を読み進める状態。置換の入れ子をまたいで共有する。 */
type Parser = {
  source: string;
  index: number;
  commands: SimpleCommand[];
  scope: number[];
  nextScopeId: number;
};

/** 1 つの読み終わり(コマンド全体・置換 1 つ)の中で組み立て中の状態。 */
type Frame = {
  /** 読み終わりの文字。null はコマンド全体の末尾まで読む。 */
  terminator: Terminator;
  words: string[];
  word: string;
  inWord: boolean;
  /** 語のどこかにクォートかバックスラッシュがあったか。heredoc の区切り語で本文の展開が変わる。 */
  isWordQuoted: boolean;
  target: RedirectTarget | null;
  heredocs: Heredoc[];
  depth: number;
};

/** 1 字句を読んだ結果。end は読み終わりに達した、null はその読み手の担当外。 */
type Step = "next" | "end" | null;

// 後続の 1 語を実行するだけの前置語。これらを越えた先の語をプログラム名とみなす。
const prefixWords = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "time",
  "exec",
  "nohup",
  "command",
  "builtin",
  "noglob",
  "sudo",
  "env",
  "nice",
  "stdbuf",
  "xargs",
]);

const assignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=/;

// ダブルクォート内でバックスラッシュがエスケープとして働く文字。
const doubleQuoteEscapable = '"\\$`\n';

// ここで区切ると、前後が別の単純コマンドになる。
const commandSeparators = ";&|";

/**
 * heredoc の本文の範囲を返す。
 *
 * @param source - コマンド全体。
 * @param start - 本文の先頭位置。
 * @param heredoc - 読む heredoc。
 * @returns 本文の終わり(終端行の行頭)と、終端行の次の位置。
 *   終端行が無ければどちらも末尾(bash も EOF までを本文とみなす)。
 */
const heredocBodyRange = (
  source: string,
  start: number,
  heredoc: Heredoc,
): { bodyEnd: number; next: number } => {
  let index = start;
  while (index < source.length) {
    const newline = source.indexOf("\n", index);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(index, end);
    const next = newline === -1 ? source.length : newline + 1;
    if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) {
      return { bodyEnd: index, next };
    }
    index = next;
  }
  return { bodyEnd: source.length, next: source.length };
};

const finishWord = (frame: Frame): void => {
  if (!frame.inWord) {
    return;
  }
  if (frame.target === "heredoc" || frame.target === "heredoc-dash") {
    frame.heredocs.push({
      delimiter: frame.word,
      stripTabs: frame.target === "heredoc-dash",
      expands: !frame.isWordQuoted,
    });
  } else if (frame.target === null) {
    frame.words.push(frame.word);
  }
  frame.word = "";
  frame.inWord = false;
  frame.isWordQuoted = false;
  frame.target = null;
};

const finishCommand = (parser: Parser, frame: Frame): void => {
  finishWord(frame);
  frame.target = null;
  if (frame.words.length > 0) {
    parser.commands.push({ words: frame.words, scope: [...parser.scope] });
  }
  frame.words = [];
};

const readRedirection = (parser: Parser, frame: Frame): void => {
  const { source } = parser;
  const first = source[parser.index];
  parser.index += 1;
  frame.target = "drop";
  if (first === "&") {
    parser.index += source[parser.index + 1] === ">" ? 2 : 1;
    return;
  }
  if (first === ">") {
    const second = source[parser.index];
    if (second === ">" || second === "|" || second === "&") {
      parser.index += 1;
    }
    return;
  }
  if (source[parser.index] === "<") {
    parser.index += 1;
    if (source[parser.index] === "<") {
      parser.index += 1;
      return;
    }
    const stripTabs = source[parser.index] === "-";
    parser.index += stripTabs ? 1 : 0;
    frame.target = stripTabs ? "heredoc-dash" : "heredoc";
    return;
  }
  if (source[parser.index] === ">" || source[parser.index] === "&") {
    parser.index += 1;
  }
};

const readSubstitution = (parser: Parser, inner: Exclude<Terminator, null>): void => {
  const outerDepth = parser.scope.length;
  parser.scope.push(parser.nextScopeId);
  parser.nextScopeId += 1;
  parse(parser, inner);
  // 置換の中で閉じ忘れた括弧があっても、置換の外の経路へ戻す。
  parser.scope.length = outerDepth;
};

// クォート無し heredoc の本文。地の文はデータだが、$(...) とバッククォートは実行される。
const readHeredocExpansions = (parser: Parser, bodyEnd: number): void => {
  while (parser.index < bodyEnd) {
    const char = parser.source[parser.index] ?? "";
    if (char === "\\") {
      parser.index += 2;
    } else if (char === "$" && parser.source[parser.index + 1] === "(") {
      parser.index += 2;
      readSubstitution(parser, ")");
    } else if (char === "`") {
      parser.index += 1;
      readSubstitution(parser, "`");
    } else {
      parser.index += 1;
    }
  }
};

const readHeredocBodies = (parser: Parser, frame: Frame): void => {
  for (const heredoc of frame.heredocs) {
    const { bodyEnd, next } = heredocBodyRange(parser.source, parser.index, heredoc);
    if (heredoc.expands) {
      readHeredocExpansions(parser, bodyEnd);
    }
    // 閉じていない置換が本文の外まで読み進んだときは戻らない。
    parser.index = Math.max(parser.index, next);
  }
  frame.heredocs = [];
};

const readDoubleQuoted = (parser: Parser, frame: Frame): void => {
  const { source } = parser;
  frame.isWordQuoted = true;
  parser.index += 1;
  while (parser.index < source.length && source[parser.index] !== '"') {
    const char = source[parser.index] ?? "";
    const next = source[parser.index + 1] ?? "";
    if (char === "\\" && doubleQuoteEscapable.includes(next)) {
      frame.word += next === "\n" ? "" : next;
      parser.index += 2;
    } else if (char === "$" && next === "(") {
      parser.index += 2;
      readSubstitution(parser, ")");
    } else if (char === "`") {
      parser.index += 1;
      readSubstitution(parser, "`");
    } else {
      frame.word += char;
      parser.index += 1;
    }
  }
  parser.index += 1;
  frame.inWord = true;
};

// 改行・空白・コメント。
const readBlank = (parser: Parser, frame: Frame, char: string): Step => {
  if (char === "\n") {
    finishCommand(parser, frame);
    parser.index += 1;
    readHeredocBodies(parser, frame);
    return "next";
  }
  if (char === " " || char === "\t") {
    finishWord(frame);
    parser.index += 1;
    return "next";
  }
  if (char === "#" && !frame.inWord) {
    while (parser.index < parser.source.length && parser.source[parser.index] !== "\n") {
      parser.index += 1;
    }
    return "next";
  }
  return null;
};

// バックスラッシュ・シングルクォート・ダブルクォート。
const readQuote = (parser: Parser, frame: Frame, char: string): Step => {
  if (char === "\\") {
    const next = parser.source[parser.index + 1] ?? "";
    if (next !== "\n") {
      frame.word += next;
      frame.inWord = true;
      frame.isWordQuoted = true;
    }
    parser.index += 2;
    return "next";
  }
  if (char === "'") {
    const close = parser.source.indexOf("'", parser.index + 1);
    const end = close === -1 ? parser.source.length : close;
    frame.word += parser.source.slice(parser.index + 1, end);
    frame.inWord = true;
    frame.isWordQuoted = true;
    parser.index = end + 1;
    return "next";
  }
  if (char === '"') {
    readDoubleQuoted(parser, frame);
    return "next";
  }
  return null;
};

// `$(` とバッククォート。バッククォートは置換の読み終わりにもなる。
const readSubstitutionToken = (parser: Parser, frame: Frame, char: string): Step => {
  if (char === "$" && parser.source[parser.index + 1] === "(") {
    parser.index += 2;
    readSubstitution(parser, ")");
    frame.inWord = true;
    return "next";
  }
  if (char === "`") {
    parser.index += 1;
    if (frame.terminator === "`") {
      finishCommand(parser, frame);
      return "end";
    }
    readSubstitution(parser, "`");
    frame.inWord = true;
    return "next";
  }
  return null;
};

const readRedirectionToken = (parser: Parser, frame: Frame, char: string): Step => {
  const isRedirection =
    char === ">" || char === "<" || (char === "&" && parser.source[parser.index + 1] === ">");
  if (!isRedirection) {
    return null;
  }
  // `2>` の 2 はファイル記述子でありコマンドの語ではない。
  if (frame.inWord && frame.target === null && /^\d+$/.test(frame.word)) {
    frame.word = "";
    frame.inWord = false;
  } else {
    finishWord(frame);
  }
  readRedirection(parser, frame);
  return "next";
};

// サブシェルの括弧。`)` は `$(` の読み終わりにもなる。
const readGroup = (parser: Parser, frame: Frame, char: string): Step => {
  if (char === "(") {
    finishCommand(parser, frame);
    parser.scope.push(parser.nextScopeId);
    parser.nextScopeId += 1;
    frame.depth += 1;
    parser.index += 1;
    return "next";
  }
  if (char === ")") {
    finishCommand(parser, frame);
    parser.index += 1;
    if (frame.terminator === ")" && frame.depth === 0) {
      return "end";
    }
    if (frame.depth > 0) {
      parser.scope.pop();
      frame.depth -= 1;
    }
    return "next";
  }
  return null;
};

// 区切り文字と、語を組み立てる地の文字。
const readPlain = (parser: Parser, frame: Frame, char: string): Step => {
  if (commandSeparators.includes(char)) {
    finishCommand(parser, frame);
  } else {
    frame.word += char;
    frame.inWord = true;
  }
  parser.index += 1;
  return "next";
};

// 読み手の並びは字句の優先順。前の読み手が担当した文字は後ろへ渡さない。
const tokenReaders = [
  readBlank,
  readQuote,
  readSubstitutionToken,
  readRedirectionToken,
  readGroup,
  readPlain,
] as const;

const readToken = (parser: Parser, frame: Frame): Step => {
  const char = parser.source[parser.index] ?? "";
  for (const reader of tokenReaders) {
    const step = reader(parser, frame, char);
    if (step !== null) {
      return step;
    }
  }
  return null;
};

const parse = (parser: Parser, terminator: Terminator): void => {
  const frame: Frame = {
    terminator,
    words: [],
    word: "",
    inWord: false,
    isWordQuoted: false,
    target: null,
    heredocs: [],
    depth: 0,
  };
  while (parser.index < parser.source.length) {
    if (readToken(parser, frame) === "end") {
      return;
    }
  }
  finishCommand(parser, frame);
};

/**
 * シェルのコマンド文字列を単純コマンドの語の並びへ分ける。
 *
 * `&&` / `||` / `;` / `|` / `&` / 改行 / 括弧で区切り、クォートを外した語にする。
 * コマンド置換(`$(...)` とバッククォート)の中身は、ダブルクォート内でも別の単純コマンドとして取り出す。
 * heredoc の本文・コメント・リダイレクト先はデータなので語に含めない。
 * ただしクォート無しの区切り語で開いた heredoc は、本文のコマンド置換だけを取り出す。
 * 字句だけの best-effort で、alias・変数展開・`bash -c` の中身は解かない。
 *
 * @param source - Bash ツールに渡されたコマンド。
 * @returns 出現順の単純コマンド。空のコマンドは含めない。
 */
export const splitSimpleCommands = (source: string): SimpleCommand[] => {
  const parser: Parser = { source, index: 0, commands: [], scope: [], nextScopeId: 0 };
  parse(parser, null);
  return parser.commands;
};

/**
 * 単純コマンドから、環境変数の代入・制御構文の語・ラッパーを外した残りを返す。
 *
 * `FOO=1 timeout 30 git push` の `git push` のように、実際に起動されるプログラムを先頭にする。
 *
 * @param words - 単純コマンドの語。
 * @returns プログラム名から始まる語。プログラムが無ければ空。
 */
export const stripCommandPrefix = (words: readonly string[]): string[] => {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (assignmentPattern.test(word) || prefixWords.has(word)) {
      index += 1;
    } else if (word === "timeout") {
      index += 1;
      while (words[index]?.startsWith("-")) {
        index += 1;
      }
      index += 1;
    } else if (word.startsWith("-") && index > 0) {
      // sudo / env / nice などラッパーのオプション。
      index += 1;
    } else {
      break;
    }
  }
  return words.slice(index);
};

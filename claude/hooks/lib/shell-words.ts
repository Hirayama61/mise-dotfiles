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
  const commands: SimpleCommand[] = [];
  const scope: number[] = [];
  let nextScopeId = 0;
  let index = 0;

  // terminator は読み終わりの文字。null はコマンド全体の末尾まで読む。
  const parse = (terminator: Terminator): void => {
    let words: string[] = [];
    let word = "";
    let inWord = false;
    // 語のどこかにクォートかバックスラッシュがあったか。heredoc の区切り語で本文の展開が変わる。
    let isWordQuoted = false;
    let target: RedirectTarget | null = null;
    let heredocs: Heredoc[] = [];
    let depth = 0;

    const finishWord = (): void => {
      if (!inWord) {
        return;
      }
      if (target === "heredoc" || target === "heredoc-dash") {
        heredocs.push({
          delimiter: word,
          stripTabs: target === "heredoc-dash",
          expands: !isWordQuoted,
        });
      } else if (target === null) {
        words.push(word);
      }
      word = "";
      inWord = false;
      isWordQuoted = false;
      target = null;
    };

    const finishCommand = (): void => {
      finishWord();
      target = null;
      if (words.length > 0) {
        commands.push({ words, scope: [...scope] });
      }
      words = [];
    };

    const readRedirection = (): void => {
      const first = source[index];
      index += 1;
      target = "drop";
      if (first === "&") {
        index += source[index + 1] === ">" ? 2 : 1;
        return;
      }
      if (first === ">") {
        if (source[index] === ">" || source[index] === "|" || source[index] === "&") {
          index += 1;
        }
        return;
      }
      if (source[index] === "<") {
        index += 1;
        if (source[index] === "<") {
          index += 1;
          return;
        }
        const stripTabs = source[index] === "-";
        index += stripTabs ? 1 : 0;
        target = stripTabs ? "heredoc-dash" : "heredoc";
        return;
      }
      if (source[index] === ">" || source[index] === "&") {
        index += 1;
      }
    };

    const readSubstitution = (inner: Exclude<Terminator, null>): void => {
      const outerDepth = scope.length;
      scope.push(nextScopeId);
      nextScopeId += 1;
      parse(inner);
      // 置換の中で閉じ忘れた括弧があっても、置換の外の経路へ戻す。
      scope.length = outerDepth;
    };

    // クォート無し heredoc の本文。地の文はデータだが、$(...) とバッククォートは実行される。
    const readHeredocExpansions = (bodyEnd: number): void => {
      while (index < bodyEnd) {
        const char = source[index] ?? "";
        if (char === "\\") {
          index += 2;
        } else if (char === "$" && source[index + 1] === "(") {
          index += 2;
          readSubstitution(")");
        } else if (char === "`") {
          index += 1;
          readSubstitution("`");
        } else {
          index += 1;
        }
      }
    };

    const readHeredocBodies = (): void => {
      for (const heredoc of heredocs) {
        const { bodyEnd, next } = heredocBodyRange(source, index, heredoc);
        if (heredoc.expands) {
          readHeredocExpansions(bodyEnd);
        }
        // 閉じていない置換が本文の外まで読み進んだときは戻らない。
        index = Math.max(index, next);
      }
      heredocs = [];
    };

    const readDoubleQuoted = (): void => {
      isWordQuoted = true;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        const char = source[index] ?? "";
        const next = source[index + 1] ?? "";
        if (char === "\\" && doubleQuoteEscapable.includes(next)) {
          word += next === "\n" ? "" : next;
          index += 2;
        } else if (char === "$" && next === "(") {
          index += 2;
          readSubstitution(")");
        } else if (char === "`") {
          index += 1;
          readSubstitution("`");
        } else {
          word += char;
          index += 1;
        }
      }
      index += 1;
      inWord = true;
    };

    while (index < source.length) {
      const char = source[index] ?? "";
      const next = source[index + 1] ?? "";

      if (char === "\n") {
        finishCommand();
        index += 1;
        readHeredocBodies();
      } else if (char === " " || char === "\t") {
        finishWord();
        index += 1;
      } else if (char === "#" && !inWord) {
        while (index < source.length && source[index] !== "\n") {
          index += 1;
        }
      } else if (char === "\\") {
        if (next !== "\n") {
          word += next;
          inWord = true;
          isWordQuoted = true;
        }
        index += 2;
      } else if (char === "'") {
        const close = source.indexOf("'", index + 1);
        const end = close === -1 ? source.length : close;
        word += source.slice(index + 1, end);
        inWord = true;
        isWordQuoted = true;
        index = end + 1;
      } else if (char === '"') {
        readDoubleQuoted();
      } else if (char === "$" && next === "(") {
        index += 2;
        readSubstitution(")");
        inWord = true;
      } else if (char === "`") {
        index += 1;
        if (terminator === "`") {
          finishCommand();
          return;
        }
        readSubstitution("`");
        inWord = true;
      } else if (char === ">" || char === "<" || (char === "&" && next === ">")) {
        // `2>` の 2 はファイル記述子でありコマンドの語ではない。
        if (inWord && target === null && /^\d+$/.test(word)) {
          word = "";
          inWord = false;
        } else {
          finishWord();
        }
        readRedirection();
      } else if (char === "(") {
        finishCommand();
        scope.push(nextScopeId);
        nextScopeId += 1;
        depth += 1;
        index += 1;
      } else if (char === ")") {
        finishCommand();
        index += 1;
        if (terminator === ")" && depth === 0) {
          return;
        }
        if (depth > 0) {
          scope.pop();
          depth -= 1;
        }
      } else if (commandSeparators.includes(char)) {
        finishCommand();
        index += 1;
      } else {
        word += char;
        inWord = true;
        index += 1;
      }
    }
    finishCommand();
  };

  parse(null);
  return commands;
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

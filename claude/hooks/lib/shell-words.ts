type RedirectTarget = "drop" | "heredoc" | "heredoc-dash";

type Heredoc = { delimiter: string; stripTabs: boolean };

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
const commandSeparators = ";&|`";

/**
 * heredoc の本文を読み飛ばす。
 *
 * @param source - コマンド全体。
 * @param start - 本文の先頭位置(heredoc を開いた行の次の行頭)。
 * @param heredocs - その行で開いた heredoc。開いた順に本文が並ぶ。
 * @returns 本文を読み終えた位置。終端行が無ければ末尾(bash も EOF までを本文とみなす)。
 */
const skipHeredocBodies = (source: string, start: number, heredocs: Heredoc[]): number => {
  let index = start;
  for (const heredoc of heredocs) {
    while (index < source.length) {
      const newline = source.indexOf("\n", index);
      const end = newline === -1 ? source.length : newline;
      const line = source.slice(index, end);
      index = newline === -1 ? source.length : newline + 1;
      if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) {
        break;
      }
    }
  }
  return index;
};

/**
 * シェルのコマンド文字列を単純コマンドの語の並びへ分ける。
 *
 * `&&` / `||` / `;` / `|` / `&` / 改行 / 括弧で区切り、クォートを外した語にする。
 * コマンド置換 `$(...)` の中身は、ダブルクォート内でも別の単純コマンドとして取り出す。
 * heredoc の本文・コメント・リダイレクト先はデータなので語に含めない。
 * 字句だけの best-effort で、alias・変数展開・`bash -c` の中身は解かない。
 *
 * @param source - Bash ツールに渡されたコマンド。
 * @returns 単純コマンドごとの語の並び。空のコマンドは含めない。
 */
export const splitSimpleCommands = (source: string): string[][] => {
  const commands: string[][] = [];
  let index = 0;

  const parse = (inSubstitution: boolean): void => {
    let words: string[] = [];
    let word = "";
    let inWord = false;
    let target: RedirectTarget | null = null;
    let heredocs: Heredoc[] = [];
    let depth = 0;

    const finishWord = (): void => {
      if (!inWord) {
        return;
      }
      if (target === "heredoc" || target === "heredoc-dash") {
        heredocs.push({ delimiter: word, stripTabs: target === "heredoc-dash" });
      } else if (target === null) {
        words.push(word);
      }
      word = "";
      inWord = false;
      target = null;
    };

    const finishCommand = (): void => {
      finishWord();
      target = null;
      if (words.length > 0) {
        commands.push(words);
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

    const readDoubleQuoted = (): void => {
      index += 1;
      while (index < source.length && source[index] !== '"') {
        const char = source[index] ?? "";
        const next = source[index + 1] ?? "";
        if (char === "\\" && doubleQuoteEscapable.includes(next)) {
          word += next === "\n" ? "" : next;
          index += 2;
        } else if (char === "$" && next === "(") {
          index += 2;
          parse(true);
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
        index = skipHeredocBodies(source, index, heredocs);
        heredocs = [];
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
        }
        index += 2;
      } else if (char === "'") {
        const close = source.indexOf("'", index + 1);
        const end = close === -1 ? source.length : close;
        word += source.slice(index + 1, end);
        inWord = true;
        index = end + 1;
      } else if (char === '"') {
        readDoubleQuoted();
      } else if (char === "$" && next === "(") {
        index += 2;
        parse(true);
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
        depth += 1;
        index += 1;
      } else if (char === ")") {
        finishCommand();
        index += 1;
        if (inSubstitution && depth === 0) {
          return;
        }
        depth = Math.max(0, depth - 1);
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

  parse(false);
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

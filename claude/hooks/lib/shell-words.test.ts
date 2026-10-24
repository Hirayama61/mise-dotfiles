import { describe, expect, test } from "bun:test";

import { splitSimpleCommands, stripCommandPrefix } from "./shell-words.ts";

const wordsOf = (source: string): string[][] =>
  splitSimpleCommands(source).map((command) => command.words);

describe("splitSimpleCommands", () => {
  describe("制御演算子と改行でつないだコマンドのとき", () => {
    test("&& / || / ; / | / & / 改行ごとに分ける", () => {
      expect(wordsOf("a 1 && b || c; d | e & f\ng")).toEqual([
        ["a", "1"],
        ["b"],
        ["c"],
        ["d"],
        ["e"],
        ["f"],
        ["g"],
      ]);
    });

    test("サブシェルの括弧を区切りとして扱う", () => {
      expect(wordsOf("(cd x && git push)")).toEqual([
        ["cd", "x"],
        ["git", "push"],
      ]);
    });
  });

  describe("クォートを含むとき", () => {
    test("クォートを外し、クォート内の演算子と空白で分けない", () => {
      expect(wordsOf(`echo "git push -f && x" 'a;b' c\\ d`)).toEqual([
        ["echo", "git push -f && x", "a;b", "c d"],
      ]);
    });

    test("クォートで囲んだだけのオプションは素の語にする", () => {
      expect(wordsOf(`git "push" '--force'`)).toEqual([["git", "push", "--force"]]);
    });
  });

  describe("コマンド置換を含むとき", () => {
    test("ダブルクォート内の $(...) も別のコマンドとして取り出す", () => {
      expect(wordsOf(`echo "x $(git reset --hard) y"`)).toEqual([
        ["git", "reset", "--hard"],
        ["echo", "x  y"],
      ]);
    });

    test("$(...) 内の heredoc 本文は、括弧やクォートを含んでもコマンドにしない", () => {
      const command = [
        `git commit -m "$(cat <<'EOF'`,
        `fix: "quoted" (paren`,
        "git push --force",
        "EOF",
        `)"`,
      ].join("\n");

      expect(wordsOf(command)).toEqual([["cat"], ["git", "commit", "-m", ""]]);
    });
  });

  describe("バッククォートのコマンド置換を含むとき", () => {
    test("ダブルクォート内のバッククォートも別のコマンドとして取り出す", () => {
      expect(wordsOf('echo "`git reset --hard`"')).toEqual([
        ["git", "reset", "--hard"],
        ["echo", ""],
      ]);
    });

    test("エスケープしたバッククォートは文字として扱う", () => {
      expect(wordsOf('echo "\\`git reset --hard\\`"')).toEqual([["echo", "`git reset --hard`"]]);
    });
  });

  describe("サブシェルとコマンド置換のスコープ", () => {
    test("括弧の中のコマンドに、外と別のスコープを付ける", () => {
      expect(splitSimpleCommands("(cd /tmp && pwd); git push")).toEqual([
        { words: ["cd", "/tmp"], scope: [0] },
        { words: ["pwd"], scope: [0] },
        { words: ["git", "push"], scope: [] },
      ]);
    });

    test("入れ子のコマンド置換は外側の経路を引き継ぐ", () => {
      expect(splitSimpleCommands("(echo $(cd x))")).toEqual([
        { words: ["cd", "x"], scope: [0, 1] },
        { words: ["echo", ""], scope: [0] },
      ]);
    });
  });

  describe("heredoc・コメント・リダイレクトを含むとき", () => {
    test("クォート無し heredoc の本文から、コマンド置換だけを取り出す", () => {
      expect(wordsOf("cat <<EOF\ngit push -f $(git reset --hard) `git clean -f`\nEOF\nls")).toEqual(
        [["cat"], ["git", "reset", "--hard"], ["git", "clean", "-f"], ["ls"]],
      );
    });

    test.each(["<<'EOF'", '<<"EOF"', "<<\\EOF", "<<E'O'F"])(
      "%s のように区切り語にクォートがあれば、本文のコマンド置換も読まない",
      (opener) => {
        expect(wordsOf(`cat ${opener}\n$(git reset --hard)\nEOF\nls`)).toEqual([["cat"], ["ls"]]);
      },
    );

    test("クォート無し heredoc でも、エスケープした \\$( は置換として読まない", () => {
      expect(wordsOf("cat <<EOF\n\\$(git reset --hard)\nEOF")).toEqual([["cat"]]);
    });

    test("heredoc の本文を語に含めない", () => {
      expect(wordsOf("cat <<EOF > out\ngit push -f\nEOF\nls")).toEqual([["cat"], ["ls"]]);
    });

    test("<<- の終端行は先頭のタブを無視して照合する", () => {
      expect(wordsOf("cat <<-END\n\tgit push -f\n\tEND\nls")).toEqual([["cat"], ["ls"]]);
    });

    test("コメントを語に含めない", () => {
      expect(wordsOf("ls # git push -f")).toEqual([["ls"]]);
    });

    test("リダイレクト先とファイル記述子を語に含めない", () => {
      expect(wordsOf("git checkout main > /dev/null 2>&1 &> log < in")).toEqual([
        ["git", "checkout", "main"],
      ]);
    });
  });
});

describe("stripCommandPrefix", () => {
  test("環境変数の代入とラッパーを外す", () => {
    expect(stripCommandPrefix(["FOO=1", "timeout", "30", "nohup", "git", "push"])).toEqual([
      "git",
      "push",
    ]);
  });

  test("ラッパーのオプションを外す", () => {
    expect(stripCommandPrefix(["sudo", "-E", "env", "-i", "git", "push"])).toEqual(["git", "push"]);
  });

  test("制御構文の語を外す", () => {
    expect(stripCommandPrefix(["then", "git", "push"])).toEqual(["git", "push"]);
  });
});

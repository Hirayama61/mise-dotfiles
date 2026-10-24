import { describe, expect, test } from "bun:test";

import { splitSimpleCommands, stripCommandPrefix } from "./shell-words.ts";

describe("splitSimpleCommands", () => {
  describe("制御演算子と改行でつないだコマンドのとき", () => {
    test("&& / || / ; / | / & / 改行ごとに分ける", () => {
      expect(splitSimpleCommands("a 1 && b || c; d | e & f\ng")).toEqual([
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
      expect(splitSimpleCommands("(cd x && git push)")).toEqual([
        ["cd", "x"],
        ["git", "push"],
      ]);
    });
  });

  describe("クォートを含むとき", () => {
    test("クォートを外し、クォート内の演算子と空白で分けない", () => {
      expect(splitSimpleCommands(`echo "git push -f && x" 'a;b' c\\ d`)).toEqual([
        ["echo", "git push -f && x", "a;b", "c d"],
      ]);
    });

    test("クォートで囲んだだけのオプションは素の語にする", () => {
      expect(splitSimpleCommands(`git "push" '--force'`)).toEqual([["git", "push", "--force"]]);
    });
  });

  describe("コマンド置換を含むとき", () => {
    test("ダブルクォート内の $(...) も別のコマンドとして取り出す", () => {
      expect(splitSimpleCommands(`echo "x $(git reset --hard) y"`)).toEqual([
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

      expect(splitSimpleCommands(command)).toEqual([["cat"], ["git", "commit", "-m", ""]]);
    });
  });

  describe("heredoc・コメント・リダイレクトを含むとき", () => {
    test("heredoc の本文を語に含めない", () => {
      expect(splitSimpleCommands("cat <<EOF > out\ngit push -f\nEOF\nls")).toEqual([
        ["cat"],
        ["ls"],
      ]);
    });

    test("<<- の終端行は先頭のタブを無視して照合する", () => {
      expect(splitSimpleCommands("cat <<-END\n\tgit push -f\n\tEND\nls")).toEqual([
        ["cat"],
        ["ls"],
      ]);
    });

    test("コメントを語に含めない", () => {
      expect(splitSimpleCommands("ls # git push -f")).toEqual([["ls"]]);
    });

    test("リダイレクト先とファイル記述子を語に含めない", () => {
      expect(splitSimpleCommands("git checkout main > /dev/null 2>&1 &> log < in")).toEqual([
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

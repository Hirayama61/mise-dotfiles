---
name: review-gate
description: push 前レビューゲートの手順。git push が `[review-gate]` で拒否されたとき、または push 前にレビューを通したいときに使う。差分の risk 判定、人間への `/code-review` の依頼、結果の triage、review flag の発行までを進める。
---

# review-gate

push gate(`~/.claude/hooks/review-gate.ts`)は、承認済みの review flag が無い差分の `git push` を拒否する。
差分は fingerprint で識別する。
この skill は flag を得るまでの手順だけを持つ。
レビューの観点は持たない。観点はレビュー対象リポジトリの `CLAUDE.md` と `.claude/rules/` が決め、`/code-review` がそれを読む。

## 守ること

- `/code-review` を Skill ツール・hook・`claude -p` から起動しない。
  レビューを走らせるかは人間が決める。コストの大きい操作の起動を人間の 1 回の入力に残すための方針で、起動できるかどうかとは関係ない。
- レビュー結果を見ずに flag を発行しない。
- flag ファイルを手で書かない。発行は `review-flag.ts approve` だけで行う。

## 手順

コマンドは対象リポジトリの作業ディレクトリで実行する。
`bun` が PATH に無ければ、gate の拒否メッセージに出た `bun` の絶対パスを使う。

1. 状態を確かめる。

   ```sh
   bun "$HOME/.claude/skills/review-gate/review-flag.ts" status
   ```

   `approved: true` なら flag は有効なので push し直す。
   `pushable_diff: false` なら送る差分が無く、gate は止めない。
   それ以外は `fingerprint` と `review_command` を控える。

2. 人間に `review_command` の実行を依頼して、そこで止まる。
   `risk` と `reasons` を添え、effort を上げ下げするかは人間に任せる。
   対象の範囲 `<base>..HEAD` は push で送る差分と同じなので変えない。

3. `/code-review` の結果を triage する。
   指摘ごとに次のどれかを決め、理由を 1 行で添えて人間に示す。

   | 判断   | 扱い                                            |
   | ------ | ----------------------------------------------- |
   | 修正   | push 前に直す                                   |
   | 要確認 | Claude では決められない。人間の判断を待つ       |
   | 見送り | 誤検知・この差分が原因でない・後続 Issue で扱う |

   修正したらコミットし、手順 1 からやり直す。差分が変わると fingerprint も変わり、前のレビューは使えない。

4. 修正と要確認が残っていなければ、手順 1 で控えた fingerprint で flag を発行する。

   ```sh
   bun "$HOME/.claude/skills/review-gate/review-flag.ts" approve --fingerprint <fingerprint> --engine code-review --effort <effort>
   ```

   レビュー後に差分が変わっていれば失敗する。そのときは手順 1 に戻る。

5. 同じ `git push` をやり直す。

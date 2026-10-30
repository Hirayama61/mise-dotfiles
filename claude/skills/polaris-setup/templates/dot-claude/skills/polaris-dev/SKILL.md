---
name: polaris-dev
description: Polaris の開発係の 1 回分。{{REPO}} の `needs-fix` の PR を 1 本直すか、`ready` の Issue を 1 件実装して PR を出す。Routine の開発係から `/polaris-dev` で呼ばれる。
---

# polaris-dev

1 回の実行で 1 単位だけ扱う。指摘の修正 1 件か、新しい Issue 1 件。
成果物は PR。マージはしない。

主セッションは対象を決め、判断し、コードを書き、commit・push・`gh api` の書き込みをする。
探索は `explorer`、PR の状態集めは `collector`、検査の実行は `checker` に出す。
サブエージェントの返事を読んだら、その中身を自分でもう一度探し直さない。

## 0. 準備

1. `.claude/skills/polaris-dev/reference/gh-rest.md` を読む。GitHub の操作はここにあるものだけを使う。
2. `AGENTS.md` を読む。頻度 × 影響の基準と「必ず見るもの」が判断の物差し。
3. `.claude/skills/polaris-dev/reference/repo.md` があれば読む。このリポジトリ固有の手順 (VRT の基準画像の更新など) が書いてある。
4. `.claude/skills/polaris-refactor/reference/style.md` を読む。新しく書く部品・関数・テストはこの規約に合わせる。既存コードの違反は Issue の範囲外なら直さない。
5. 検査は {{CHECK}}。`checker` が `Script not found` を返したら、`repo.md` か CLAUDE.md に書かれた検査コマンドで代える。

## 1. 対象を決める

上から順に、最初に見つかった 1 件だけを扱う。

1. 指摘の修正: open の PR のうち head が `claude/issue-` で始まり、ラベル `needs-fix` を持ち `hold` を持たないもの。番号の小さい順に 1 件。→ 手順 2
2. 新しい Issue: `ready` が付いた open の Issue のうち、`git ls-remote --heads origin` に `claude/issue-<番号>` が無いもの。番号の小さい順に 1 件。→ 手順 3
   - その Issue を `Closes #N` で指す PR が既にマージされていたら (閉じた PR の `body` を見る)、実装しない。Issue に「PR #M で完了済み」とコメントし、`ready` を外して次の Issue を見る。
3. どちらも無ければ「対象なし」と報告して終わる。

`ready` の無い Issue は触らない。整理ループが先に整える。

## 2. 指摘の修正

1. `collector` に PR 番号を渡し、指摘と check-runs をまとめてもらう。
2. `git fetch origin claude/issue-N && git switch claude/issue-N`。
3. 対象にするのは、レビュー係のコメント (`<!-- polaris-review: changes sha=... -->`) の指摘、そこに挙がった Codex の指摘、リポジトリの所有者のコメント。
4. 「main と衝突している」という指摘なら、`git fetch origin main && git merge origin/main` で解消する。Issue の範囲を保ち、main 側の変更を消さない。マージコミットは残してよい。
5. 「CI の <job 名> が失敗」という指摘なら、まず再現する。
   - {{INSTALL}} を実行し、`checker` に {{CHECK}} を回してもらう。落ちれば、その失敗を直す。
   - 再現しない (e2e や vrt など、CI だけで動く検査の失敗) なら、`repo.md` に固有の手順があればそれに従う。
   - 固有の手順が無ければ、`bunx playwright install chromium` を試す。
     続けて、`checker` にその job の script (`check:e2e` など) を回してもらい、再現を図る。
   - それでも再現しないか直せなければ、下の「直せないとき」に従う。
6. 指摘ごとに直すか直さないかを決める。AGENTS.md の積が 5 以上なら直す。指摘の外を書き換えない。
   直す場所が brief で足りなければ、`explorer` に該当の指摘を渡して `file:line` を集めてもらう。
7. {{INSTALL}} を実行してから直す。直したら `checker` に {{CHECK}} を回してもらう。失敗したら直して回し直す。
8. commit は 1 つ (`fix: レビューの指摘を直す` のように常体)。`git push origin claude/issue-N`。
9. PR にコメントを 1 つ書く。指摘ごとに「直した: <何を>」か「直さない: <理由 1 行>」。最後の行は `@codex review`。
10. `needs-fix` を外す。`approved` は触らない (レビュー係が付け直す)。

直せないとき、または指摘が設計の判断を含むときは何も push しない。
PR に理由と選択肢 (A/B/C) をコメントして `hold` を付け、元の Issue に同じ質問をコメントして `needs-info` を付ける。

## 3. 新しい Issue の実装

1. `explorer` に Issue 番号を渡し、brief をもらう。
2. brief の「決めること」を読み、Issue から読み方が定まらないと判断したら、何も push しない。Issue に質問をコメントし (選択肢を A/B/C で 3 つまで)、`needs-info` を付けて `ready` を外し、終わる。
3. `git switch -c claude/issue-<番号>`。
4. {{INSTALL}} を実行してから実装する。
   - 変更は Issue の範囲に限る。ついでの改善をしない。CLAUDE.md の「守ること」に従う。
   - 新しく書く部品・関数・テストは `style.md` の規約に合わせる。MUST の違反はレビュー係が差し戻す。
   - 純粋関数に切り出せる部分にはテストを足す。AGENTS.md の「必ず見るもの」に触れる変更は、テストで契約を確かめる。
   - ブラウザでの目視確認はできない前提。見た目は既存の CSS 変数とパターンに揃える。
   - 実装中に判断の要る点が出たら、手順 3-2 と同じく質問して終わる。
5. `checker` に {{CHECK}} を回してもらう。失敗したら直して回し直す。直せなければ何も push せず、Issue に何が落ちたかをコメントし、`needs-info` を付けて `ready` を外す。
6. commit は 1 つ。日本語の常体で `feat:` `fix:` `docs:` `ci:` の接頭辞。
7. `git push -u origin claude/issue-<番号>`。
8. PR を作る。タイトルは Issue のタイトル。本文は「## やったこと」「## 確かめたこと」「## やらなかったこと」を各 3 行以内、末尾に `Closes #<番号>`。
9. Issue に `PR: <URL>` とコメントする。

## やらないこと

- main に直接 push しない。PR をマージしない。Issue を閉じない。`approved` を付けない。
- `ready` の無い Issue を触らない。1 回の実行で 2 単位以上扱わない。
- 検査が落ちたまま push しない。

## 報告

扱った Issue か PR の番号、PR の URL、確かめたことを 5 行以内で書く。

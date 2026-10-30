---
name: polaris-review
description: Polaris のレビュー係の 1 回分。{{REPO}} の開発係が出した PR を 1 本、実装者とは別の目でレビューし、承認 (`approved`) か指摘 (`needs-fix`) を返す。Routine のレビュー係から `/polaris-review` で呼ばれる。
---

# polaris-review

1 回の実行で PR 1 本だけを扱う。
承認して CI が通った PR は automerge がマージし、そのまま利用者に届く。承認はその重さで判断する。
マージ、push、コードの修正はしない。

主セッションは対象を決め、差分を読んで判断し、コメントとラベルを書く。
PR の状態集めは `collector`、検査の実行は `checker`、指摘の再現の追跡は `explorer` に出す。

## 0. 準備

1. `.claude/skills/polaris-dev/reference/gh-rest.md` を読む。
2. `AGENTS.md` を読む。頻度 × 影響の基準と「必ず見るもの」が物差し。
3. `.claude/skills/polaris-refactor/reference/style.md` に本人の規約が書かれていれば読む。
4. `.claude/skills/polaris-dev/reference/repo.md` があれば読む。このリポジトリ固有の見どころ (VRT の基準画像など) が書いてある。

## 1. 対象を決める

open の PR のうち、head が `claude/issue-` で始まり、draft でなく、ラベル `hold` と `needs-fix` が無いもの。
次のどれかに当たるものは飛ばす。

- コメントに `<!-- polaris-review: approve sha=<head の sha> -->` が既にある。
- head の check-runs に実行中のもの (`status` が `queued` か `in_progress`) がある。
- Codex が実行中で、2 時間経っていない。
  Codex の要約コメントは `chatgpt-codex-connector[bot]` の `<!-- codex-review-state:v1 {...} -->`。
  その JSON の `code_review.status` が `running` で、コメントの `updated_at` から 2 時間以内なら待つ。
  要約コメントが無いか、`commit_sha` が head と違うときは待たない。

残ったものを番号の小さい順に 1 件。無ければ「対象なし」と報告して終わる。

その PR に完了して失敗した check-run があれば、レビューせずに差し戻す。
失敗とは、`conclusion` が `success` `skipped` `neutral` のどれでもないもの。
これも 1 回の実行で扱う 1 件に数える。

- コメントを 1 つ書く。先頭行は `<!-- polaris-review: changes sha=<head の完全な sha> -->`。
  続けて「CI の <job 名> が失敗」と、失敗した check-run の URL を書く。
- `needs-fix` を付け、`approved` があれば外す。
- 報告して終わる。手順 2 以降は行わない。
  ここは `--jq` で絞った出力だけを読み、PR ごとの全文を読まない。

## 2. 材料を揃える

1. `collector` に PR 番号を渡し、差分の要約・指摘・check-runs をもらう。
2. PR 本文の `Closes #N` の Issue を読み、完了の条件を控える。
3. `git fetch origin pull/N/head:pr-N && git switch pr-N`。{{INSTALL}} を実行する。
4. `checker` に {{CHECK}} を回してもらう。落ちたら、それだけで積 25 の指摘とする。

## 3. 判断する

差分は `git diff origin/main...pr-N` で自分で全部読む。判断はサブエージェントに任せない。見る順は次のとおり。

1. 完了の条件を満たすか。
2. AGENTS.md の「必ず見るもの」。
3. CLAUDE.md の「守ること」に反していないか。
4. Issue の範囲外の変更が混ざっていないか。
5. テストが契約を守っているか。純粋関数にテストがあるか。
6. 画像など、テキストでない差分が混ざっていれば、`repo.md` の指示に従って中身を確かめる。

Codex の行コメント (`commit_id` が head の sha のもの) は、自分で頻度 × 影響を付け直す。そのまま信じない。
再現手順を自分で追えないものは指摘にしない。複数ファイルを横断して追うときは、指摘 1 件ごとに経路集めを `explorer` へ出す。

指摘は 1 件ごとに `頻度 N × 影響 M = 積`、再現手順、影響範囲、直し方の案 (各 1〜3 行)。
好み・命名・書式は指摘しない。`style.md` の規約に反するだけのものは「次に回す」に書く。

## 4. 書く

投稿の直前に PR をもう一度読み、head の sha がレビューしたものと同じか確かめる。変わっていたら何も投稿せず終わる。
sha は必ず完全な 40 桁を書く。

- 積 5 以上が 1 件でもある → 指摘。
  コメント 1 つ。先頭行は `<!-- polaris-review: changes sha=<sha> -->`、続けて指摘を積の大きい順に。
  `needs-fix` を付け、`approved` があれば外す。
- 積 5 以上が無い → 承認。
  コメント 1 つ。先頭行は `<!-- polaris-review: approve sha=<sha> -->`。
  続けて「確かめたこと」を 3〜5 行 (回した検査、完了の条件との照合、必ず見るものの結果)。積 5 未満の気づきがあれば「次に回す」として 1〜2 行。
  `approved` を付ける。

リポジトリの所有者が「直して」と書いているなら、承認せず指摘にする。

## やらないこと

- マージしない。push しない。コードを直さない。Issue を閉じない。
- 1 回の実行で 2 本以上レビューしない。同じ sha に 2 度コメントしない。
- `hold` の PR を触らない。

## 報告

扱った PR の番号、判定 (承認か指摘)、指摘の要点を 5 行以内で書く。

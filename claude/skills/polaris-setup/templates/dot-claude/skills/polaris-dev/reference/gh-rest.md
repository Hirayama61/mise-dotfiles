# クラウド環境の gh REST 早見表

Polaris のループのスキル (`polaris-*`) と、そのサブエージェントが共通で使う。

クラウドの GitHub は `gh api` (REST) だけが使える。
`gh issue` `gh pr` は GraphQL なので 403 になる。使わない。
認証情報を探したり設定したりしない。
`O/R` は `{{REPO}}`。

## 読む

| 用途                        | コマンド                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Issue 一覧                  | `gh api --paginate 'repos/{{REPO}}/issues?state=open&labels=ready&per_page=100'` (`pull_request` キーを持つ要素は PR なので除く) |
| Issue 1 件                  | `gh api repos/{{REPO}}/issues/N`                                                                                                 |
| ラベルで全件 (閉じたものも) | `gh api --paginate 'repos/{{REPO}}/issues?state=all&labels=audit:uiux&per_page=100'`                                             |
| PR 一覧                     | `gh api --paginate 'repos/{{REPO}}/pulls?state=open&per_page=100'`、閉じたもの `state=closed`                                    |
| PR 1 件                     | `gh api repos/{{REPO}}/pulls/N` (`head.sha` `head.ref` `mergeable_state` `labels` `body`)                                        |
| 差分                        | `gh api --paginate 'repos/{{REPO}}/pulls/N/files?per_page=100'`                                                                  |
| コメント                    | `gh api --paginate 'repos/{{REPO}}/issues/N/comments?per_page=100'`                                                              |
| 行コメント                  | `gh api --paginate 'repos/{{REPO}}/pulls/N/comments?per_page=100'`                                                               |
| レビュー                    | `gh api --paginate 'repos/{{REPO}}/pulls/N/reviews?per_page=100'`                                                                |
| check-runs                  | `gh api --paginate 'repos/{{REPO}}/commits/<sha>/check-runs?per_page=100' --jq '.check_runs[]'`                                  |
| ブランチの有無              | `git ls-remote --heads origin`                                                                                                   |
| PR のブランチを取る         | `git fetch origin pull/N/head:pr-N && git switch pr-N`                                                                           |

一覧を取る GET は `--paginate` と `per_page=100` を付ける。既定の 30 件で切れると、古いコメントや目印を見落とす。
`--jq` で必要なキーだけに絞ってから読む。本文を丸ごと出力しない。

## 書く

書き込みは主セッションだけが行う。サブエージェントは書かない。

| 用途       | コマンド                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| PR 作成    | `gh api -X POST repos/{{REPO}}/pulls -f title='...' -f head='claude/issue-N' -f base=main -f body='...'`                    |
| Issue 作成 | `gh api -X POST repos/{{REPO}}/issues -f title='...' -f body="$(cat body.md)" -f 'labels[]=audit:uiux' -f 'labels[]=ready'` |
| コメント   | `gh api -X POST repos/{{REPO}}/issues/N/comments -f body='...'` (PR にも使える)                                             |
| ラベル追加 | `gh api -X POST repos/{{REPO}}/issues/N/labels -f 'labels[]=needs-info'`                                                    |
| ラベル削除 | `gh api -X DELETE repos/{{REPO}}/issues/N/labels/ready` (404 は無視)                                                        |
| assignee   | `gh api -X POST repos/{{REPO}}/issues/N/assignees -f 'assignees[]=<login>'` (PR にも使える)                                 |

本文が複数行なら、ファイルに書いて `-f body="$(cat file)"` で渡す。
`-f` は文字列、`-F` は数値や真偽値として送る。

## 目印のコメント

ループ同士は本文に埋めた HTML コメントで状態を受け渡す。書式を変えない。

- `<!-- polaris-review: approve sha=<完全な sha> -->`: レビュー係がその sha を承認した。automerge が読む。
- `<!-- polaris-review: changes sha=<完全な sha> -->`: レビュー係か automerge が、その sha に指摘を返した。開発係が直す。
- `<!-- polaris-review: followup pr=<N> sha=<完全な sha> -->`: 承認した PR の残りの指摘 (積 5〜24) の Issue。
  1 行目に置く。同じ PR と sha では 1 件だけ。
- `<!-- polaris-audit: <kind> key=<キー> -->`: 監査係が起票した Issue の 1 行目。同じキーは二度起票しない。
- `<!-- codex-review-state:v1 {...} -->`: Codex (`chatgpt-codex-connector[bot]`) の要約コメント。JSON の `code_review.status` と `commit_sha` で進み具合が分かる。

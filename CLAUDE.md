# CLAUDE.md

## CLAUDE.md の書き方

このファイルの内容は全セッションに注入されるため、毎回の判断に必要な情報のみを書く。  
一部でしか使わないような知識は、その変更のコミットメッセージに書き込むこと。

## このリポジトリについて

Apple Silicon macOS 用の dotfiles。  
プライベート端末と業務端末で使用する共通設定を管理する。

## 責務の境界

| 対象                 | 役割                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install.sh`         | ghq が入っていない環境でも ghq_root 配下にリポジトリを clone し、mise を導入する                                                                         |
| `mise run git-setup` | このリポジトリに対して commit / push できる状態にする。commit するのはプライベート端末だけのため任意タスクとし、実行しなくても `mise run setup` へ進める |
| `mise run setup`     | `mise bootstrap` で、`mise.toml` に宣言したツールと設定(dotfiles・shell activation・`[tools]`)を PC に適用する                                           |
| `mise run check`     | TypeScript と Markdown を format / lint / type check / 重複検査 / test で検証する                                                                        |

Homebrew の formula が要るときは `mise.toml` の `[bootstrap.packages]` に `brew:` で宣言する。Homebrew CLI の導入を書かない。

## 知識の置き場所

| 種類                                        | 置き場所                                                            |
| ------------------------------------------- | ------------------------------------------------------------------- |
| 状態(PR / Issue のマージ状況、未実施・保留) | 書かない。毎回 `git` / `gh` から取る                                |
| 全リポジトリに効く恒久的な規約              | `claude/rules/`                                                     |
| このリポジトリの恒久的な方針                | `CLAUDE.md`                                                         |
| 一部でしか使わない局所的な知識              | その変更のコミットメッセージ                                        |
| auto memory                                 | 使わない。`autoMemoryEnabled: false` を `mise run setup` が配布する |

## worktree 運用

Claude は main clone(`~/ghq` 配下のプライマリ作業ツリー)を編集しない。hook が拒否する。
編集は `EnterWorktree` で作った worktree で行う。
配置は gwq の規約(`~/worktrees/<host>/<owner>/<repo>/<branch>`)に従う。
人間は `gwq add -b <branch>` で同じ場所に作る。
1 worktree = 1 ブランチ。同じブランチの続きは既存の worktree を使う。

## 不可逆な git / gh 操作

force push・保護ブランチでの push / merge・未コミット作業の破棄などは `block-irreversible-git` hook が止める。
止められたら書き方を変えて迂回しない。コマンドを人間に示し、`!` での実行を頼む。

## push 前レビュー

`git push` が `[review-gate]` で止められたら、`review-gate` skill の手順で flag を得る。
`/code-review` は人間に実行を頼み、Claude からは起動しない。
flag ファイルを手で書いて迂回しない。

## Claude Code の設定管理

`claude/rules`・`claude/hooks`・`claude/agents`・`claude/statusline` は `~/.claude` 配下へ symlink する。
`claude/skills` は `~/.claude/skills/<skill>/` 配下へファイルごとに symlink する。`~/.claude/skills` には Claude Code が `synced/` を作るため。
`~/.claude/settings.json` は Claude Code 自身が `/config` の値を書くため symlink にしない。
`bin/claude-settings.ts` が管理キーだけをマージ書き込みする。
管理キーは `~/.claude/hooks` を指す hook の登録と `autoMemoryEnabled`・`statusLine` だけで、それ以外には触れない。
Claude Code が自動生成するファイル・ディレクトリは symlink 管理に含めない。

## subagent の使い分け

判断を伴わない委任作業(所在の探索・計画への質問生成・決まったコマンドの実行・差分と要件の照合・指摘 1 件の反証)は `claude/agents/` の Haiku 固定の役へ渡す。
設計判断・実装・レビューの結論は主セッションが担う。
役の定義は `model: haiku` と `effort: low` を固定し、書き込み系ツールを持たせない。

## Issue 起案

Issue の起案は `/create-issue` で行う。作業中にその場で直せない摩擦や課題を見つけたら、実行を提案する。

## スクリプトの実装言語

判断ロジックと UI は Bun/TypeScript で書く。  
Shell へ残すのは、Bun を用意するまでに走る処理だけ。

`bin/` 配下の TypeScript は npm パッケージに依存させない。  
初期端末では `bun install` より前に走るため。  
`package.json` の依存は検証ツール(`devDependencies`)だけに閉じる。

## テスト

テストの書き方と実機に残す範囲は `.claude/rules/testing.md` に従う。  
TS を書くときは、外部効果(ファイルパス・コマンド)を環境変数と `PATH` 経由で参照し、テストから逸らせるようにする。

## 配色

`bin/lib/palette.sh` が Panda 配色の単一ソース。  
このリポジトリで管理している全てのツールの配色はこのテーマで統一すること。  
設定ファイルへは `mise.toml` の `[vars]`(palette.sh の写し。`config/palette.test.ts` が一致を検査)から Tera テンプレートで展開する。  
Tera で描画するファイルに zsh の文字数展開のような波括弧とシャープの並びを書かない。衝突するスクリプトは静的ファイルにして tmux のオプション経由で色を受け取る。

## ツール設定の置き場所

ツールの設定は `config/<tool>/` に置き、`mise.toml` の `[dotfiles]` で `~/.config` 配下へ配る。  
ディレクトリごと symlink できるものはそのまま、配色など環境差の展開が要るファイルだけ `mode = "template"` にする。  
ツールが自動生成するファイル(`lazy-lock.json` 等)はリポジトリに入れない。  
シェルは fish。zsh と zed の設定は持ち込まない。

## fish のドキュメント

fish は man ページと HTML ドキュメントを同梱する。
コマンドの仕様は `man fish` / `man fish-doc`、組み込み関数は `help <name>` でローカルの HTML を開く。
公式に `llms.txt` は無いため、Bun のような目次取得タスクは作らない。

## ブラウザツール

`agent-browser` は AI が Web ページを調査するためのブラウザ。`mise run setup` で導入する。
動作確認や E2E に使うブラウザ(Playwright)は各リポジトリの `devDependencies` に置き、ここでは管理しない。

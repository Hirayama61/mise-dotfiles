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
| `mise run check`     | TypeScript と Markdown を format / lint / type check で検証する                                                                                          |

Homebrew の formula が要るときは `mise.toml` の `[bootstrap.packages]` に `brew:` で宣言する。Homebrew CLI の導入を書かない。

## Issue 起案

Issue の起案は `/create-issue` で行う。作業中にその場で直せない摩擦や課題を見つけたら、実行を提案する。

## スクリプトの実装言語

判断ロジックと UI は Bun/TypeScript で書く。  
Shell へ残すのは、Bun を用意するまでに走る処理だけ。

`bin/` 配下の TypeScript は npm パッケージに依存させない。  
初期端末では `bun install` より前に走るため。  
`package.json` の依存は検証ツール(`devDependencies`)だけに閉じる。

## 配色

`bin/lib/palette.sh` が Panda 配色の単一ソース。  
このリポジトリで管理している全てのツールの配色はこのテーマで統一すること。  
設定ファイルへは `mise.toml` の `[vars]`(palette.sh の写し。`config/palette.test.ts` が一致を検査)から Tera テンプレートで展開する。  
Tera で描画するファイルに zsh の文字数展開のような波括弧とシャープの並びを書かない。衝突するスクリプトは静的ファイルにして tmux のオプション経由で色を受け取る。

## ツール設定の置き場所

ツールの設定は `config/<tool>/` に置き、`mise.toml` の `[dotfiles]` で `~/.config` 配下へ配る。  
ディレクトリごと symlink できるものはそのまま、配色など環境差の展開が要るファイルだけ `mode = "template"` にする。  
ツールが自動生成するファイル(`lazy-lock.json` 等)はリポジトリに入れない。  
シェルは fish に寄せる(#9)。zsh と zed の設定は持ち込まない。

## ブラウザツール

`agent-browser` は AI が Web ページを調査するためのブラウザ。`mise run setup` で導入する。
動作確認や E2E に使うブラウザ(Playwright)は各リポジトリの `devDependencies` に置き、ここでは管理しない。

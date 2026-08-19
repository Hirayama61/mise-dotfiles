# CLAUDE.md

## CLAUDE.md の書き方

このファイルの内容は全セッションに注入されるため、毎回の判断に必要な情報のみを書く。  
一部でしか使わないような知識は、その変更のコミットメッセージに書き込むこと。

## このリポジトリについて

Apple Silicon macOS 用の dotfiles。  
プライベート端末と業務端末で使用する共通設定を管理する。

## 責務の境界

| 対象 | 役割 |
|---|---|
| `install.sh` | ghq が入っていない環境でも ghq_root 配下にリポジトリを clone/fetch する |
| `bin/bootstrap.sh` | Homebrew / mise を用意して Deno の bootstrap を起動する最小ランチャー |
| `bin/bootstrap.ts` | このリポジトリに対して commit / push できる状態にする |
| `mise run setup` | このリポジトリで管理している設定を PC に適用する |
| `mise run test` | Deno の format / lint / type check / test をまとめて実行する |

## bootstrap の実装方針

環境構築の判断ロジックや UI は TypeScript に置き、Shell は Deno を起動するために必要な処理だけに限定する。  
副作用を伴わない判断ロジックは `bin/lib/bootstrap_logic.ts` に置き、`Deno.test` で仕様を固定する。

## 配色

`bin/lib/palette.ts` が Panda 配色の単一ソース。  
このリポジトリで管理している全てのツールの配色はこのテーマで統一すること。

# mise-dotfiles

mise をベースとした macOS 向けの dotfiles。

## セットアップ

リポジトリを ghq 配下へ clone し、土台ツール(Homebrew・mise・Bun)を導入する。
最後に Git 設定へ進むかを尋ね、次に実行するコマンドを表示してクリップボードへ入れる。
`curl | bash` の形にしないのは、stdin がスクリプト本文になり Homebrew インストーラの対話と衝突するため。

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hirayama61/mise-dotfiles/main/install.sh)"
```

Git 設定(任意)。gh の認証と git identity を設定し、commit / push できる状態にする。
この端末から commit しないなら飛ばしてよい。
入れたばかりの端末では mise が PATH に無いため、install.sh がクリップボードへ入れる `cd` と `eval` 付きのコマンドをそのまま使う。

```sh
mise run git-setup
```

このリポジトリで管理しているツールの導入や設定を適用する。

```sh
mise run setup
```

## install.sh が行うこと

リポジトリを取得し、土台ツールを導入する。
既にあれば最新へ更新する。

| ツール                   | インストール済みの場合         |
| ------------------------ | ------------------------------ |
| Xcode Command Line Tools | 案内して終了(自動では入れない) |
| Homebrew                 | 何もしない                     |
| mise                     | 何もしない                     |
| Bun                      | 何もしない                     |

Homebrew を新しく入れる場合は sudo のパスワードを求められる。
`sudo -v` は NOPASSWD が設定されていてもパスワードを要求するため、どちらの端末でも 1 度は入力が要る。

## mise run git-setup が行うこと

Git 周りを設定する。
`user.name` と `user.email` のどちらかが欠けている時だけ対話に入り、GitHub アカウントから候補を出す。

| 対象                          | 設定済みの場合             |
| ----------------------------- | -------------------------- |
| ghq / gh                      | 足りないものだけ入れる     |
| GitHub 認証                   | 何もしない                 |
| git の user.name / user.email | 両方揃っていれば何もしない |

### SSH 越しにセットアップする場合

GitHub の認証でブラウザを開けないため、表示されたコードを接続元のブラウザで入力する。

1. `! First copy your one-time code: XXXX-XXXX` のコードを控える
2. Enter を押す(ブラウザの起動には失敗するが認証は続く)
3. 接続元のブラウザで <https://github.com/login/device> を開きコードを入力する

## mise run setup が行うこと

`mise.toml` の `[tools]` にあるツールを入れ、設定ファイルをホームディレクトリへ symlink する。
何度実行しても同じ結果になる。

| 対象               | 内容                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Bun / node         | `mise install` で入れる                                                                          |
| agent-browser      | AI が Web ページを調査するためのブラウザ CLI。npm backend で入れる                               |
| Chrome for Testing | `agent-browser install` が `~/.agent-browser/browsers` へ置く(約 180 MB)。導入済みなら何もしない |
| `~/.claude/rules`  | `claude/rules` への symlink。symlink でない実体があれば上書きせず止まる                          |

`agent-browser` は `/create-issue` が ChatGPT の共有チャットを読むために使う。
共有ページの本文はクライアント側で描画されるため、HTML を取るだけでは読めない。

## 開発

スクリプトと文書の検証には Bun を使う。
`mise run setup` で Bun が入る。

```sh
mise run check
```

`mise run check` が回す検証は 5 つ。

| ツール            | 対象                         | 内容              |
| ----------------- | ---------------------------- | ----------------- |
| oxfmt             | TypeScript / JSON / Markdown | 整形              |
| oxlint            | TypeScript                   | lint              |
| tsc               | TypeScript                   | 型検査            |
| markdownlint-cli2 | Markdown                     | 構造の lint       |
| textlint          | Markdown                     | 日本語の文章 lint |

Bun は型を検査せず、型を落として実行するだけ。
型エラーを見つけるには `tsc --noEmit` が要る。

Bun 公式ドキュメントの目次を `docs/bun-llms.txt` に置いている。
各ページは `.md` 付きの URL で個別に取得できる。
目次が古くなったら `mise run docs` で取り直す。

### CodeRabbit のレビュー依頼

star が 10 未満の public リポジトリは CodeRabbit の自動レビュー対象外で、PR へ明示的に依頼しないとレビューが走らない。
PR 画面のチェックボックスか、`@coderabbitai full review` のコメントで依頼する。
`@coderabbitai review` は差分レビュー用で、自動レビューを pause した PR でしか効かない。

## 構成

```text
mise-dotfiles/
├── install.sh          curl の入口。clone と Homebrew・mise・Bun の導入
├── bin/
│   ├── git-setup.ts    commit / push できる状態にする任意タスク
│   ├── symlink.ts      設定ファイルをホームディレクトリへ symlink する
│   └── lib/
│       ├── palette.sh  Panda 配色の単一ソース
│       ├── palette.ts  palette.sh を TypeScript から読み込む
│       ├── ui.sh       install.sh の表示部品
│       └── ui.ts       TypeScript タスクの表示と対話部品
├── claude/
│   └── rules/          Claude Code が全プロジェクトで読む規約群
│       ├── japanese-writing.md  日本語の文章規範(常時)
│       └── typescript.md        コーディング規約(.ts を触るときだけ)
├── .claude/
│   ├── rules/          このリポジトリだけで読む規約群
│   └── skills/         このリポジトリだけで使うスキル群
│       └── create-issue/  Issue 起案の手順
├── docs/
│   └── bun-llms.txt    Bun 公式ドキュメントの目次
├── package.json        検証ツールの依存とスクリプト
├── tsconfig.json       TypeScript の設定
└── mise.toml           全タスクの入口と、管理するツールの一覧
```

## ライセンス

MIT

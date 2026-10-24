# mise-dotfiles

mise をベースとした macOS 向けの dotfiles。

## セットアップ

リポジトリを ghq 配下へ clone し、mise を導入する。
最後に Git 設定へ進むかを尋ね、次に実行するコマンドを表示してクリップボードへ入れる。
Homebrew と sudo は要らない。

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Hirayama61/mise-dotfiles/main/install.sh)"
```

Git 設定(任意)。gh の認証と git identity を設定し、commit / push できる状態にする。
この端末から commit しないなら飛ばしてよい。
入れたばかりの端末では `~/.local/bin` が PATH に無いため、install.sh は `~/.local/bin/mise run git-setup` の形で案内する。

```sh
mise run git-setup
```

このリポジトリで管理しているツールと設定を PC に適用する。
実行後に開いた端末は fish がログインシェルになり、パス無しの `mise` が使える。

```sh
mise run setup
```

## install.sh が行うこと

リポジトリを取得し、mise を導入する。
既にあれば最新へ更新する。

| ツール                   | インストール済みの場合         |
| ------------------------ | ------------------------------ |
| Xcode Command Line Tools | 案内して終了(自動では入れない) |
| mise                     | 何もしない                     |

mise は <https://mise.run> のインストーラで `~/.local/bin/mise` へ入る。
Bun などの `[tools]` は `mise run` が足りない分を自動で入れるため、ここでは導入しない。

## mise run git-setup が行うこと

Git 周りを設定する。
`user.name` と `user.email` のどちらかが欠けている時だけ対話に入り、GitHub アカウントから候補を出す。

| 対象                          | 設定済みの場合             |
| ----------------------------- | -------------------------- |
| gh                            | 何もしない                 |
| GitHub 認証                   | 何もしない                 |
| git の user.name / user.email | 両方揃っていれば何もしない |

### SSH 越しにセットアップする場合

GitHub の認証でブラウザを開けないため、表示されたコードを接続元のブラウザで入力する。

1. `! First copy your one-time code: XXXX-XXXX` のコードを控える
2. Enter を押す(ブラウザの起動には失敗するが認証は続く)
3. 接続元のブラウザで <https://github.com/login/device> を開きコードを入力する

## mise run setup が行うこと

`mise bootstrap --yes` を実行し、`mise.toml` の宣言どおりにツールと設定を適用する。
既に済んでいる項目は飛ばすので、何度実行しても同じ結果になり、2 度目からは sudo と対話が発生しない。

| 対象                                                                        | 内容                                                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude/rules`                                                           | `claude/rules` への symlink。symlink でない実体があれば上書きせず止まる                                                                  |
| `~/.config/{git,tmux,nvim,ghostty,tig,gwq,mise}`・`~/.config/starship.toml` | `config/<tool>/` の実体。配色が要る git の config / starship.toml / tmux.conf は Tera で描画し、他は symlink                             |
| `~/.gitconfig`                                                              | 共有設定(`~/.config/git/config`)の include ブロックだけを管理する。`user.name` などの端末ローカル値はそのまま                            |
| tig・cask 5 件                                                              | `[bootstrap.packages]` から入れる(ghostty / raycast / obsidian / coderabbit / JetBrains Mono Nerd Font)                                  |
| macOS defaults                                                              | Finder / Dock / キーボード / トラックパッド / Spotlight ショートカットを `[bootstrap.macos.*]` から書く。Finder と Dock は再起動後に反映 |
| fish                                                                        | Homebrew で入れ、`/etc/shells` に登録してログインシェルにする(初回は sudo を求められる)                                                  |
| `~/.config/fish/config.fish`                                                | `config/fish/config.fish` への symlink。Homebrew と `~/.local/bin` の PATH、mise と starship の活性化                                    |
| Bun / node                                                                  | `[tools]` から入れる                                                                                                                     |
| agent-browser                                                               | AI が Web ページを調査するためのブラウザ CLI。npm backend で入れる                                                                       |
| Chrome for Testing                                                          | `agent-browser install` が `~/.agent-browser/browsers` へ置く(約 180 MB)。導入済みなら何もしない                                         |

シェルは fish に寄せる。zsh の設定は管理せず、zsh の startup file にも書かない。
ログインシェルの変更は新しいターミナルから効く。
Homebrew の formula が要るときは `[bootstrap.packages]` に `"brew:<formula>" = "latest"` と書く。
mise が bottle を `/opt/homebrew` へ直接置くので Homebrew CLI は要らず、既に Homebrew がある端末ではその formula として共存する。

`agent-browser` は `/create-issue` が ChatGPT の共有チャットを読むために使う。
共有ページの本文はクライアント側で描画されるため、HTML を取るだけでは読めない。

### 配色の流れ

`bin/lib/palette.sh` が Panda 配色の単一ソース。
`mise.toml` の `[vars]` に同じ値を hex で持ち、`config/**` のテンプレートが `{{ vars.panda_<name> }}` で読む。
両者のずれは `config/palette.test.ts` が `mise run check` で止める。
tmux の補助スクリプト(`jump.zsh` / `cheatsheet.sh`)は `tmux.conf` が書く `@panda_*` オプションから色を読む。
tig と ghostty のテーマは端末の ANSI 16 色で表すため静的ファイル。

起動音を OFF にする `nvram` だけは defaults で書けないため、`mise run macos:startup-mute` に分けてある(sudo が要る)。

## 開発

スクリプトと文書の検証には Bun を使う。
無ければ `mise run` が入れる。

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
├── install.sh          curl の入口。clone と mise の導入
├── bin/
│   ├── git-setup.ts    commit / push できる状態にする任意タスク
│   └── lib/
│       ├── palette.sh  Panda 配色の単一ソース
│       ├── palette.ts  palette.sh を TypeScript から読み込む
│       ├── ui.sh       install.sh の表示部品
│       └── ui.ts       TypeScript タスクの表示と対話部品
├── config/             ツール設定(~/.config 配下へ symlink / Tera 描画)
│   ├── fish/           fish の設定(PATH・mise・starship の活性化)
│   ├── git/            共有設定・hooks(Conventional Commits、機密語、secretlint)・ignore
│   ├── tmux/           tmux.conf と popup スクリプト(jump / cheatsheet / split-even)
│   ├── nvim/           Neovim(lazy.nvim)
│   ├── ghostty/        Ghostty と Panda テーマ
│   ├── tig/ gwq/       静的設定
│   ├── mise/           mise のグローバル設定(どの cwd でも使うツール)
│   ├── starship.toml   プロンプト
│   └── palette.test.ts [vars] と palette.sh の一致検査
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
└── mise.toml           管理するツール・設定の宣言と、全タスクの入口
```

## ライセンス

MIT

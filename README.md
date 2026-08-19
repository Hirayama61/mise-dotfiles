# mise-dotfiles

mise をベースとした macOS 向けの dotfiles。

## セットアップ

リポジトリを ghq 配下に clone/fetch する。

```sh
curl -fsSL https://raw.githubusercontent.com/Hirayama61/mise-dotfiles/main/install.sh | bash
```

続けて Homebrew / mise を必要に応じて導入し、Deno/TypeScript 製の bootstrap を起動する。
clone 先は ghq の設定に従うため、実際のパスは install.sh が表示してクリップボードへ入れる。

```sh
cd ~/ghq/github.com/Hirayama61/mise-dotfiles && ./bin/bootstrap.sh
```

このリポジトリで管理しているツールの導入や設定を適用する。

```sh
mise run setup
```

## bootstrap が行うこと

`bin/bootstrap.sh` は Homebrew / mise を用意して `mise exec deno@2` で `bin/bootstrap.ts` を起動するだけの薄いランチャー。  
GitHub 認証、ghq / gh の導入、git identity の設定、UI は TypeScript 側が担当する。

`git config --get user.name` と `user.email` のどちらかが未設定の時だけ対話に入り、GitHub アカウントから候補を出す。

| ツール | インストール済みの場合 |
|---|---|
| Xcode Command Line Tools | 案内して終了(自動では入れない) |
| Homebrew | 何もしない |
| mise | 何もしない |
| Deno | mise が必要なバージョンを用意する |
| ghq / gh | 足りないものだけ入れる |
| GitHub 認証 | 何もしない |
| git の user.name / user.email | 何もしない |

Homebrew を新しく入れる場合は sudo のパスワードを求められる。

### SSH 越しにセットアップする場合

GitHub の認証でブラウザを開けないため、表示されたコードを接続元のブラウザで入力する。

1. `! First copy your one-time code: XXXX-XXXX` のコードを控える
2. Enter を押す(ブラウザの起動には失敗するが認証は続く)
3. 接続元のブラウザで <https://github.com/login/device> を開きコードを入力する

## テスト

bootstrap の TypeScript は Deno 標準の format / lint / type check / test で検証する。

```sh
mise run test
```

## 構成

```text
mise-dotfiles/
├── install.sh                 curl の入口。clone/fetch するだけ
├── deno.json                  Deno の format / lint / test 設定
├── bin/
│   ├── bootstrap.sh           Homebrew / mise を用意する最小ランチャー
│   ├── bootstrap.ts           commit / push できる状態まで整える本体
│   └── lib/
│       ├── bootstrap_logic.ts 判断ロジック
│       ├── command.ts         外部コマンド実行
│       ├── palette.ts         Panda 配色の単一ソース
│       └── ui.ts              バナー・状態表示・対話
└── mise.toml                  全タスクの入口
```

## ライセンス

MIT

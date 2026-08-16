# mise-dotfiles

mise をベースとした macOS 向けの dotfiles。

## セットアップ

リポジトリを ghq 配下に clone し、セットアップ用のコマンドをクリップボードへ入れる。

```sh
curl -fsSL https://raw.githubusercontent.com/Hirayama61/mise-dotfiles/main/install.sh | bash
```

ツールを導入し、Git 周りの設定を行う。
clone 先は ghq の設定に従うため、実際のパスは install.sh が表示してクリップボードへ入れる。
末尾の `eval` は、Homebrew を新しく入れた場合に PATH をこの端末へ通す。

```sh
cd ~/ghq/github.com/Hirayama61/mise-dotfiles && ./bin/bootstrap.sh && eval "$(/opt/homebrew/bin/brew shellenv)"
```

このリポジトリで管理しているツールの導入や設定を適用する。

```sh
mise run setup
```

## bootstrap.sh が行うこと

ツールのインストールと Git 周りの設定を行う。  
`user.name` と `user.email` のどちらかが欠けている時だけ対話に入り、GitHub アカウントから候補を出す。  

| ツール | インストール済みの場合 |
|---|---|
| Xcode Command Line Tools | 案内して終了(自動では入れない) |
| Homebrew | 何もしない |
| mise | 何もしない |
| ghq / gh | 足りないものだけ入れる |
| GitHub 認証 | 何もしない |
| git の user.name / user.email | 両方揃っていれば何もしない |

Homebrew を新しく入れる場合は sudo のパスワードを求められる。
`sudo -v` は NOPASSWD が設定されていてもパスワードを要求するため、どちらの端末でも 1 度は入力が要る。

### SSH 越しにセットアップする場合

GitHub の認証でブラウザを開けないため、表示されたコードを接続元のブラウザで入力する。

1. `! First copy your one-time code: XXXX-XXXX` のコードを控える
2. Enter を押す(ブラウザの起動には失敗するが認証は続く)
3. 接続元のブラウザで <https://github.com/login/device> を開きコードを入力する

## 構成

```text
mise-dotfiles/
├── install.sh          curl の入口。clone するだけ
├── bin/
│   ├── bootstrap.sh    commit / push できる状態まで
│   └── lib/
│       ├── palette.sh  Panda 配色の単一ソース
│       └── ui.sh       バナー・状態表示・対話
└── mise.toml           全タスクの入口
```

## ライセンス

MIT

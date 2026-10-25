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

| 対象                                                                        | 内容                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/.claude/rules`                                                           | `claude/rules` への symlink。symlink でない実体があれば上書きせず止まる                                                                    |
| `~/.claude/hooks`                                                           | `claude/hooks` への symlink。Claude Code の hook 本体                                                                                      |
| `~/.claude/settings.json`                                                   | 管理キー(hook の登録・`autoMemoryEnabled: false`・`statusLine`)だけをマージ書き込みする。model や theme などの端末ローカルの値には触れない |
| `~/.claude/statusline`                                                      | `claude/statusline` への symlink。ステータスラインの描画スクリプト                                                                         |
| `~/.claude/agents`                                                          | `claude/agents` への symlink。Haiku 固定の役割限定 subagent 5 役                                                                           |
| `~/.claude/skills/<skill>/`                                                 | `claude/skills/` の各ファイルへの個別の symlink(テストは除く)。Claude Code が `synced/` を置くので、ディレクトリは実体のまま               |
| `~/.config/{git,tmux,nvim,ghostty,tig,gwq,mise}`・`~/.config/starship.toml` | `config/<tool>/` の実体。配色が要る git の config / starship.toml / tmux.conf は Tera で描画し、他は symlink                               |
| `~/.gitconfig`                                                              | 共有設定(`~/.config/git/config`)の include ブロックだけを管理する。`user.name` などの端末ローカル値はそのまま                              |
| tig・cask 4 件                                                              | `[bootstrap.packages]` から入れる(ghostty / raycast / google-chrome / JetBrains Mono Nerd Font)。手動で入れた Chrome は置き換えず取り込む  |
| macOS defaults                                                              | Finder / Dock / キーボード / トラックパッド / Spotlight ショートカットを `[bootstrap.macos.*]` から書く。Finder と Dock は再起動後に反映   |
| fish                                                                        | Homebrew で入れ、`/etc/shells` に登録してログインシェルにする(初回は sudo を求められる)                                                    |
| `~/.config/fish/config.fish`                                                | `config/fish/config.fish` への symlink。中身を持たない入口                                                                                 |
| `~/.config/fish/conf.d/*.fish`                                              | `config/fish/conf.d/` の各ファイルへの symlink。PATH、mise・starship の活性化、tmux の自動起動を役割ごとのファイルに分ける                 |
| Bun / node                                                                  | `[tools]` から入れる                                                                                                                       |
| agent-browser                                                               | AI が Web ページを調査するためのブラウザ CLI。npm backend で入れる                                                                         |
| Chrome for Testing                                                          | `agent-browser install` が `~/.agent-browser/browsers` へ置く(約 180 MB)。導入済みなら何もしない                                           |

シェルは fish に寄せる。zsh の設定は管理せず、zsh の startup file にも書かない。
ログインシェルの変更は新しいターミナルから効く。
Homebrew の formula が要るときは `[bootstrap.packages]` に `"brew:<formula>" = "latest"` と書く。
mise が bottle を `/opt/homebrew` へ直接置くので Homebrew CLI は要らず、既に Homebrew がある端末ではその formula として共存する。

`agent-browser` は `/create-issue` が ChatGPT の共有チャットを読むために使う。
共有ページの本文はクライアント側で描画されるため、HTML を取るだけでは読めない。

### Claude Code の worktree 運用

Claude は main clone(`~/ghq` 配下のプライマリ作業ツリー)を編集しない。
編集は `EnterWorktree` で作る worktree の中で行い、人間が同じ配置に作るときは `gwq add -b <branch>` を使う。

| hook                    | 発火                                         | 内容                                                                                                              |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `block-main-clone-edit` | Edit / Write / MultiEdit / NotebookEdit の前 | 対象が `~/ghq` 配下の main clone 本体なら拒否し、`EnterWorktree` へ案内する。linked worktree はどこにあっても通す |
| `create-worktree`       | `EnterWorktree`・subagent の worktree 隔離   | 既定の `.claude/worktrees/` 配下でなく、`gwq add` で `~/worktrees/<host>/<owner>/<repo>/<branch>` に作る          |

`create-worktree` はブランチ名に worktree の名前をそのまま使い、同じブランチの worktree が既にあればそれを返す。
作れなかったときは失敗として止まり、既定配置へ黙って落とさない。
hook は Claude Code を通る操作にだけ効く。
人間の手編集と、Claude が Bash で直接打つ `git worktree add` は対象外。

### Claude Code の不可逆操作の遮断

`block-irreversible-git` hook が、Claude の Bash 呼び出しのうち取り返しのつかない git / gh 操作を、走る前に止める。
止めたときは理由と代わりの行動を Claude に返す。
人間はプロンプトで `!` に続けて同じコマンドを打てば実行できる。`!` のコマンドは hook を通らない。

| 分類                    | 止めるコマンド                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| force push              | `git push` の `--force` / `--force-with-lease` / `--force-if-includes` / `-f`                                                                                             |
| 保護ブランチ            | 現在ブランチが `main` / `master` / `develop` のときの `git push` / `git merge`(`merge --abort` は通す)                                                                    |
| 未コミット作業の破棄    | `reset --hard`、`clean -f`、`stash drop` / `clear`、`checkout --` / `-f` / パス指定、`switch --discard-changes` / `-f`、`restore`、`branch -D`、`worktree remove --force` |
| push 済み HEAD の amend | HEAD が remote ブランチに含まれるときの `git commit --amend`                                                                                                              |
| フックの迂回            | `git commit --no-verify` / `-n`                                                                                                                                           |
| gh の外向き操作         | `pr merge` / `close` / `ready`、`release create` / `delete` / `edit`、`repo delete` / `archive` / `edit`                                                                  |

コマンドは `&&` / `;` / `|` やコマンド置換で区切った単純コマンドごとに判定する。
クォート内の文字列・heredoc の本文・コメントは見ないので、`echo "git push -f"` や `git log | grep push` は止まらない。
ただし実行されるコマンド置換(`$(...)` とバッククォート)は、ダブルクォート内やクォート無し heredoc の本文にあっても判定する。
現在ブランチは `cd <dir> &&` と `git -C <dir>` の先で調べる。
サブシェル内の `cd` は外の後続コマンドに効かせず、同じコマンド内で先に `switch` / `checkout` したブランチは後続の判定に使う。
git 外・ブランチ不明・入力の解析失敗では止めない。

判定は字句の best-effort で、うっかり実行の抑止にとどまる。
alias・`bash -c`・変数展開を経由した形と、明示 refspec(`git push origin HEAD:main`、`+branch`)は止まらない。
`permissions.deny` は使わない。
deny ルールは理由を返せず、`git -C . push` のような形もすり抜けるため。

auto memory は `autoMemoryEnabled: false` で全リポジトリ止める。
必要なリポジトリだけ `.claude/settings.local.json` で ON にできる。

### Claude Code の push 前レビューゲート

`review-gate` hook が、承認済みの review flag が無い差分の `git push` を止める。
止めたときは差分の risk と、人間が打つ `/code-review <effort> <base>..HEAD` を Claude に返す。
以降の手順は personal skill `review-gate` が持つ。

1. 人間が案内された `/code-review` を実行する
2. Claude が指摘を修正・要確認・見送りに振り分け、修正したらコミットしてレビューからやり直す
3. 修正と要確認が残っていなければ、Claude がレビュー前に控えた fingerprint で flag を発行する
4. 同じ diff の push が通る

`/code-review` は skill・hook・`claude -p` から起動しない。
コストの大きいレビューを走らせるかは、人間の 1 回の入力で決める方針のため。
レビューの観点は dotfiles に置かず、対象リポジトリの `CLAUDE.md` と `.claude/rules/` に任せる。

差分は、upstream があればそれ、無ければ origin の既定ブランチと HEAD の merge-base から HEAD まで。
未コミットの変更は push されないので含めない。
fingerprint はこの差分の SHA-256 で、差分が 1 文字でも変われば flag は効かなくなる。
flag の置き場所は `~/.local/state/claude-review-gate/<repo>-<hash>/<fingerprint>.json`。
同じリポジトリの worktree はこの置き場所を共有する。

| 項目                        | 内容                                             |
| --------------------------- | ------------------------------------------------ |
| `schema_version`            | `1`                                              |
| `engine`                    | レビューしたエンジン(`code-review` など)。記録用 |
| `effort`                    | レビューの effort。記録用                        |
| `reviewed_diff_fingerprint` | 承認した差分の fingerprint                       |
| `approved`                  | `true` のときだけ push を通す                    |
| `reviewed_at`               | 発行日時                                         |

hook が見るのは `schema_version`・`approved`・`reviewed_diff_fingerprint` だけで、エンジンが変わっても hook は変えずに済む。

risk はパスの規則で決める(`claude/hooks/lib/review-gate.ts` の `riskRules`)。
内容は読まず、案内する effort を決めるためだけに使う。

| risk   | effort   | 該当するパス                                                                                                    |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------- |
| HIGH   | `high`   | 認証(`auth*`・`oauth`・`login`・`session`・`jwt`・`password`・`credential`)                                     |
| HIGH   | `high`   | migration・スキーマ(`migrations/`・`schema.{rb,prisma,sql,graphql}`・`*.sql`)                                   |
| HIGH   | `high`   | 権限(`permission`・`rbac`・`acl`・`policy`・`role`・`guard`・`.claude/settings*.json`)                          |
| HIGH   | `high`   | CI 設定(`.github/workflows/`・`.github/actions/`・`.gitlab-ci.yml`・`.circleci/`)                               |
| HIGH   | `high`   | 秘密情報(`.env*`・`secret`・`*.pem`・`*.key`・`*.p12`)                                                          |
| MEDIUM | `medium` | 依存の manifest と lockfile(`package.json`・`bun.lock`・`go.mod`・`Cargo.toml` など)、または 400 行を超える差分 |
| LOW    | `low`    | それ以外                                                                                                        |

名前の規則はパスの区切りごとに、語そのものか、語に `.`・`_`・`-` が続く形に当てる。`author.ts` は認証に当たらない。
force push・dry-run・`--delete` は対象外で、force 系は `block-irreversible-git` が止める。
git 外・差分の起点の不明・送るコミット無し・入力の解析失敗では止めない。
人間の `!git push` は hook を通らないので縛らない。

flag の発行は Claude 自身が行うので、ゲートは手順を飛ばさないための仕組みで、改ざんへの防御ではない。

### Claude Code のステータスライン

`claude/statusline/statusline.ts` が、Claude Code から stdin で受けた JSON を 1 行に描画する。

```text
Opus │ ctx ⣦        8% │ 5h ⣿⣷       24% 3h05m │ 7d ⣿⣿⣿⣄     41% 5d3h │ ⎇ feat/statusline │ wt feat-statusline │ PR #1234 pending
```

| 区画        | 出どころ                                               | 無いとき                         |
| ----------- | ------------------------------------------------------ | -------------------------------- |
| モデル名    | `model.display_name`                                   | 省く                             |
| `ctx`       | `context_window.used_percentage`                       | 省く(セッション開始直後は null)  |
| `5h` / `7d` | `rate_limits.*`(使用率とリセットまでの残り時間)        | 省く(Pro / Max 以外・初回応答前) |
| `⎇`         | `git symbolic-ref`(detached HEAD は短縮 SHA)           | 省く(git 外・500ms で打ち切り)   |
| `wt`        | `workspace.git_worktree`                               | 省く(main clone)                 |
| `PR`        | `pr.number` と `pr.review_state`。番号は PR へのリンク | 省く(open PR が無いブランチ)     |

バーと使用率の色は `palette.sh` から読み、0〜50% を mint から orange、50〜80% を orange から red へ補間する。
80% 以上は red。
`COLUMNS` より長くなるときは区画の切れ目で折り返す。
`NO_COLOR` を設定すると色とリンクを付けない。
stdin が JSON でなくても 0 で終わり、その旨を 1 行で出す。

`statusLine` は管理キーなので、`/statusline` で書き換えた値は `mise run setup` の再実行で戻る。
変えたいときは `claude/statusline/statusline.ts` を編集する。

### Haiku 固定の subagent

判断を伴わない委任作業を、主セッションのモデルでなく Haiku に逃がすための 5 役。
どの役も設計判断・提案・実装をせず、判断が要る状況では決めるべき事項を主セッションへ返す。
`@scout` のように名指しでも起動できる。

| 役                | 仕事                                                     | 返すもの                                       |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `scout`           | シンボル・ファイル・呼び出し元・設定の所在を探す         | `file:line` と抜粋                             |
| `plan-questioner` | 計画や Issue 本文から、暗黙に決めることになる事項を拾う  | 質問の一覧(回答も提案も含まない)               |
| `operator`        | test / lint / typecheck などの決まったコマンドを実行する | 終了コードと失敗箇所の要約                     |
| `diff-checker`    | 差分と完了条件を突き合わせる                             | 条件ごとの対応表と、範囲外の変更               |
| `refuter`         | レビュー指摘 1 件を崩す根拠を探す                        | 「反証」か「反証できず」と決め手の `file:line` |

同名の定義がプロジェクトの `.claude/agents/` にあればそちらが優先される。

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

`mise run check` が回す検証は 6 つ。

| ツール            | 対象                            | 内容              |
| ----------------- | ------------------------------- | ----------------- |
| oxfmt             | TypeScript / JSON / Markdown    | 整形              |
| oxlint            | TypeScript                      | lint              |
| tsc               | TypeScript                      | 型検査            |
| markdownlint-cli2 | Markdown                        | 構造の lint       |
| textlint          | Markdown                        | 日本語の文章 lint |
| bun test          | `bin/`・`claude/` の TypeScript | テスト            |

テストだけを回すには `mise exec -- bun test` を使う。
テストは対象の隣の `<対象>.test.ts` にあり、書き方と実機に残す範囲は `.claude/rules/testing.md` に従う。

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
│   ├── claude-settings.ts  ~/.claude/settings.json へ管理キーをマージ書き込みする
│   └── lib/
│       ├── fixtures/   テストが子プロセスとして実行する入口
│       ├── palette.sh  Panda 配色の単一ソース
│       ├── palette.ts  palette.sh を TypeScript から読み込む
│       ├── ui.sh       install.sh の表示部品
│       └── ui.ts       TypeScript タスクの表示と対話部品
├── config/             ツール設定(~/.config 配下へ symlink / Tera 描画)
│   ├── fish/           fish の設定(conf.d/ に PATH・mise・starship・tmux 自動起動を分けて置く)
│   ├── git/            共有設定・hooks(Conventional Commits、機密語、secretlint)・ignore
│   ├── tmux/           tmux.conf と popup スクリプト(jump / cheatsheet / split-even)
│   ├── nvim/           Neovim(lazy.nvim)
│   ├── ghostty/        Ghostty と Panda テーマ
│   ├── tig/ gwq/       静的設定
│   ├── mise/           mise のグローバル設定(どの cwd でも使うツール)
│   ├── starship.toml   プロンプト
│   └── palette.test.ts [vars] と palette.sh の一致検査
├── claude/
│   ├── rules/          Claude Code が全プロジェクトで読む規約群
│   │   ├── japanese-writing.md  日本語の文章規範(常時)
│   │   └── typescript.md        コーディング規約(.ts を触るときだけ)
│   ├── agents/         Haiku 固定の役割限定 subagent(~/.claude/agents から symlink)
│   ├── statusline/     ステータスラインの描画スクリプト(~/.claude/statusline から symlink)
│   ├── skills/         personal skill(~/.claude/skills/<skill>/ へファイルごとに symlink)
│   │   └── review-gate/  push 前レビューの手順と、flag を発行する review-flag.ts
│   └── hooks/          Claude Code の hook 本体(~/.claude/hooks から symlink)
│       ├── block-main-clone-edit.ts   main clone 本体の編集を拒否する
│       ├── block-irreversible-git.ts  不可逆な git / gh 操作を拒否する
│       ├── create-worktree.ts         EnterWorktree の worktree を gwq の規約の場所に作る
│       ├── review-gate.ts             review flag の無い差分の git push を拒否する
│       └── lib/                       stdin の読み取り・git の判定・シェルの字句分割
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

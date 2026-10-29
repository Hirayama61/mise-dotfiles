---
name: polaris-setup
description: GitHub リポジトリ 1 つを Polaris の開発ループに登録する対話型セットアップ。`/polaris-setup owner/repo` で、ラベル 5 種、CLAUDE.md の節、AGENTS.md、check.yml、polaris-data の `projects/<slug>.md`、開発ループの Routine を揃える。
---

# polaris-setup

リポジトリを Polaris の開発ループに載せる部品を揃える。
仕様は polaris-data の `ops-rules/README.md` の「Issue のラベル」「リポジトリに入れる部品」「ループ一覧」にある。
雛形はこの skill の `templates/` にある (`~/.claude/skills/polaris-setup/templates/`)。

## 守ること

- 何度実行しても同じ結果になる。あるものは触らない。
  ファイルは節やファイルが既にあれば書かない。ラベルは名前・色・説明を揃えるだけで消さない。Routine は同じリポジトリのものがあれば作らない。
- 確認は手順 2 の 1 回だけ。以降は聞き直さず進め、決められないことは最後の報告に残す。
- main clone (`~/ghq` 配下) を編集しない。hook が拒否する。編集は worktree で行う。
- `git push` が `[review-gate]` で止まったら、`/review-gate` の手順に従う。flag を手で書いて迂回しない。

以下、`O/R` は引数の `owner/repo`、`<default>` はデフォルトブランチを指す。
引数がなければ AskUserQuestion で `owner/repo` を聞く。

## 1. 調べる

```sh
gh api repos/O/R --jq '{default_branch, description, language}'
gh api repos/O/R/contents --jq '.[].name'
gh api repos/O/R/contents/package.json --jq .content | base64 -d   # 主要ファイルを同じ形で読む
gh api repos/O/R/labels --paginate --jq '.[] | [.name, .color, .description] | @tsv'
```

`CLAUDE.md` (`## 開発の流れ` と `## ラベル` の有無)、`AGENTS.md`、`.github/workflows/check.yml` の有無を `contents` で調べる。404 はないものとする。
polaris-data の `projects/` に `github: O/R` を持つファイルがあれば、その slug と `name` を既定値にする。
RemoteTrigger の `list` で、`sources` に `https://github.com/O/R` を持つ Routine を探す。RemoteTrigger が未読込なら `ToolSearch` の `select:RemoteTrigger` で読み込む。

検査コマンドは上から順に最初に当てはまる行で推定する。

| 手がかり                       | 雛形             | `{{INSTALL}}`                    | `{{CHECK}}` の既定値                                       |
| ------------------------------ | ---------------- | -------------------------------- | ---------------------------------------------------------- |
| `mise.toml` に `[tasks.check]` | `check-mise.yml` | `mise install`                   | `mise run check`                                           |
| `bun.lock` か `bun.lockb`      | `check-bun.yml`  | `bun install --frozen-lockfile`  | `bun run test`、`bunx tsc --noEmit`、`bun run build`       |
| `pnpm-lock.yaml`               | `check-pnpm.yml` | `pnpm install --frozen-lockfile` | `pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build`        |
| `Cargo.toml`                   | なし             | `cargo fetch`                    | `cargo test`、`cargo clippy -- -D warnings`、`cargo build` |

`package.json` の `scripts` にない script と、`tsconfig.json` がないときの `tsc` は既定値から外す。
雛形のないスタックは check.yml を置かず、報告の残作業に入れる。

## 2. 確かめる

AskUserQuestion を 1 回だけ呼び、次の 4 問をまとめて聞く。各問の先頭の選択肢を手順 1 の推定値にする。

1. polaris-data 上の slug と表示名 (既定: リポジトリ名と、既存の `projects/*.md` の `name`)。
2. 検査コマンド (既定: 手順 1 の推定値)。
3. 開発ループを動かす時間帯 (既定: 毎時 7〜24 時 JST = cron `0 0-15,22,23 * * *` UTC)。
4. Routine を今作るか (既定: 作る)。

## 3. ラベルを揃える

先に改名する。旧名だけがあるときに限り PATCH で改名し、Issue に付いた履歴を保つ。新旧両方あるときは旧名を残し、報告に書く。

```sh
gh api -X PATCH repos/O/R/labels/needs-input -f new_name=needs-info
gh api -X PATCH 'repos/O/R/labels/status%3Aready' -f new_name=ready
```

次に 5 種を揃える。一致するものは触らない。

```sh
gh api -X POST repos/O/R/labels -f name=<name> -f color=<色> -f description=<説明>   # ないもの
gh api -X PATCH repos/O/R/labels/<name> -f color=<色> -f description=<説明>        # 色か説明が違うもの
```

| ラベル       | 色       | 説明                                      |
| ------------ | -------- | ----------------------------------------- |
| `ready`      | `0e8a16` | 整理済み。開発ループが実装してよい        |
| `needs-info` | `d876e3` | 質問中。答えは Polaris の質問タスクに書く |
| `split`      | `fbca04` | 小さな Issue に分割した元。閉じるのは人   |
| `hold`       | `e4e669` | 人の判断待ち。ループは触らない            |
| `human`      | `0e8a16` | 人がやる Issue。ループは触らない          |

## 4. リポジトリに部品を入れる

```sh
main=$(ghq root)/github.com/O/R
[ -d "$main" ] || ghq get O/R
git -C "$main" fetch origin
wt=~/worktrees/github.com/O/R/polaris-setup
[ -d "$wt" ] || git -C "$main" worktree add -b polaris-setup "$wt" origin/<default>
```

`polaris-setup` ブランチが既にあれば、その worktree を使い直す。
`gh api 'repos/O/R/pulls?head=O:polaris-setup&state=open'` で PR が開いていれば、ここは飛ばして報告に PR の URL を書く。

worktree の中で、ないものだけを置く。

- `CLAUDE.md`: `templates/CLAUDE-section.md` の `## 開発の流れ` と `## ラベル` のうち、ない節だけを末尾に追記する。ファイル自体がなければ `# <表示名>` の見出しを付けて作る。「守ること」は人が書くので作らない。
- `AGENTS.md`: `templates/AGENTS.md` を置く。README と主要なソースを読んで、プレースホルダを埋める。
  `{{USAGE}}` は誰がどのくらい使うか、`{{WORST}}` は最悪の壊れ方、`{{MUST_SEE_1}}`〜`{{MUST_SEE_3}}` は影響度が高くなりやすい 3 点。
  各項目に関わるファイルをコードスパンで添える。
- `.github/workflows/check.yml`: 手順 1 の雛形をコピーする。`# {{CHECK_STEPS}}` の行は、検査コマンド 1 つにつき `- run: <コマンド>` 1 行に置き換える。

置換の規則は次のとおり。

- `{{REPO}}` は `O/R`。
- `{{CHECK}}` と `{{INSTALL}}` は、コマンドをコードスパンで囲み「、」でつなぐ。
- `<default>` が `main` でなければ、雛形と指示文の `main` をそのブランチ名に置き換える。
- 置換後に `{{` が残っていないことを `grep -rn '{{' CLAUDE.md AGENTS.md .github/workflows/check.yml` で確かめる。

変更があれば 1 つにまとめて commit する。メッセージは `chore: Polaris の開発ループ用の部品を入れる`。
`git push -u origin polaris-setup` で push する。止まったら `/review-gate` の手順で flag を得てから push し直す。
PR は `gh pr create --base <default> --head polaris-setup` で作る。本文に置いたものと、人が書く「守ること」が残っている旨を書く。

## 5. polaris-data に登録する

polaris-data の main clone は hook が編集を止めるので、worktree で作業する。

```sh
pd=$(ghq root)/github.com/Hirayama61/polaris-data
git -C "$pd" fetch origin
wt=~/worktrees/github.com/Hirayama61/polaris-data/polaris-setup-<slug>
[ -d "$wt" ] || git -C "$pd" worktree add -b polaris-setup-<slug> "$wt" origin/main
```

`projects/<slug>.md` がなければ次の形で作る。「## 目指すもの」はリポジトリの説明から 2〜3 行で書く。

```markdown
---
name: <表示名>
kind: code
status: active
github: O/R
---

## 目指すもの

- <説明から 2〜3 行>
```

既にあれば、frontmatter にない `kind`・`status`・`github` のキーだけを足し、本文に「## 目指すもの」がなければ足す。
既存の値は書き換えない。`github` が `O/R` と違う値なら書き換えず、報告に書く。
変更があれば `feat: <slug> を開発ループに登録する` で commit する。
`git push -u origin polaris-setup-<slug>` で push し、`gh pr create --base main` で PR を作る。
push が止まったら手順 4 と同じく `/review-gate` に従う。

## 6. Routine を作る

手順 2 で「作らない」を選んだとき、または手順 1 で同じリポジトリの Routine が見つかったときは作らない。
後者は既存の Routine の URL を報告する。

`templates/routine-dev-loop.md` を手順 4 と同じ規則で置換し、全文を指示文にする。
RemoteTrigger の `create` に次の body を渡す。`uuid` は新しい小文字の v4 UUID を作って入れる。
時間帯を既定から変えたときは、`name` の括弧内と `cron_expression` をそれに合わせる。

```json
{
  "name": "<R> 開発係 (毎時 7-24 JST)",
  "cron_expression": "0 0-15,22,23 * * *",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "env_018RTHQZ1mJG47167UUSL7LZ",
      "events": [
        {
          "data": {
            "uuid": "<v4 UUID>",
            "session_id": "",
            "type": "user",
            "parent_tool_use_id": null,
            "message": { "content": "<指示文>", "role": "user" }
          }
        }
      ],
      "session_context": {
        "allowed_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
        "model": "claude-opus-5-5",
        "sources": [{ "git_repository": { "url": "https://github.com/O/R" } }]
      }
    }
  }
}
```

環境 `env_018RTHQZ1mJG47167UUSL7LZ` は「Polaris」。
作成後に `get` で `name`・`cron_expression`・`sources`・指示文の先頭行を確かめる。
報告する URL は `https://claude.ai/code/routines/<trigger_id>`。

## 7. 報告する

10 行以内で次を書く。

- やったこと: ラベル (作成・改名・更新の数)、置いたファイル、2 つの PR の URL、Routine の URL。
- 触らなかったもの: 既にあったため飛ばしたもの。
- 人の作業: 2 つの PR のマージ、CLAUDE.md の「守ること」、AGENTS.md の「必ず見るもの」の見直し。
- 残った不一致: 新旧両方あるラベル、`github` の値の違い、雛形のないスタック。

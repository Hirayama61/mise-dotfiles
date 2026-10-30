---
name: polaris-setup
description: GitHub リポジトリ 1 つを Polaris の開発ループに登録する対話型セットアップ。`/polaris-setup owner/repo` で、ラベル 8 種、CLAUDE.md の節、AGENTS.md、check.yml、`.claude/agents` と `.claude/skills`、bun + Vite + React なら品質の土台 (Biome、Storybook、VRT、E2E)、polaris-data の `projects/<slug>.md`、Routine 5 本 (開発係、レビュー係、監査係 3 本) を揃える。
---

# polaris-setup

リポジトリを Polaris の開発ループに載せる部品を揃える。
仕様は polaris-data の `ops-rules/README.md` の「Issue のラベル」「リポジトリに入れる部品」「ループ一覧」にある。
雛形はこの skill の `templates/` にある (`~/.claude/skills/polaris-setup/templates/`)。

## 守ること

- 何度実行しても同じ結果になる。あるものは触らない。
  ファイルは節やファイルが既にあれば書かない。ラベルは名前・色・説明を揃えるだけで消さない。Routine は同じリポジトリの同じ役割のものがあれば作らない。
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
RemoteTrigger の `list` で、`sources` に `https://github.com/O/R` を持つ Routine を探す。役割は `name` の「開発係」「レビュー係」「UI/UX 監査係」「セキュリティ監査係」「リファクタリング監査係」で見分ける。RemoteTrigger が未読込なら `ToolSearch` の `select:RemoteTrigger` で読み込む。

検査コマンドは上から順に最初に当てはまる行で推定する。

| 手がかり                       | 雛形             | `{{INSTALL}}`                    | `{{CHECK}}` の既定値                                       |
| ------------------------------ | ---------------- | -------------------------------- | ---------------------------------------------------------- |
| `mise.toml` に `[tasks.check]` | `check-mise.yml` | `mise install`                   | `mise run check`                                           |
| `bun.lock` か `bun.lockb`      | `check-bun.yml`  | `bun install --frozen-lockfile`  | `bun run test`、`bunx tsc --noEmit`、`bun run build`       |
| `pnpm-lock.yaml`               | `check-pnpm.yml` | `pnpm install --frozen-lockfile` | `pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build`        |
| `Cargo.toml`                   | なし             | `cargo fetch`                    | `cargo test`、`cargo clippy -- -D warnings`、`cargo build` |

`package.json` の `scripts` にない script と、`tsconfig.json` がないときの `tsc` は既定値から外す。
`bun.lock` があり、`package.json` の依存に `vite` と `react` があれば、品質の土台 (手順 4b) の対象とする。
このとき `{{CHECK}}` の既定値は `bun run check`、check.yml の雛形は `quality/.github/workflows/check.yml` にする。
雛形のないスタックは check.yml を置かず、報告の残作業に入れる。

## 2. 確かめる

AskUserQuestion を 1 回だけ呼び、次の 5 問をまとめて聞く。各問の先頭の選択肢を手順 1 の推定値にする。

1. polaris-data 上の slug と表示名 (既定: リポジトリ名と、既存の `projects/*.md` の `name`)。
2. 検査コマンド (既定: 手順 1 の推定値)。
3. 開発ループを動かす時間帯 (既定: 毎時 7〜24 時 JST = cron `0 0-15,22,23 * * *` UTC)。
4. Routine を今作るか (既定: 作る)。
5. 監査ループ 3 本 (UI/UX、セキュリティ、リファクタリング) の Routine も作るか (既定: 作る)。問 4 で「作らない」なら聞かずに「作らない」とする。
6. 品質の土台 (Biome、Storybook、VRT、E2E) を入れるか (既定: 入れる)。手順 1 で対象外なら聞かずに「入れない」とする。
   入れないときは、問 2 の既定値を bun の行の 3 コマンドに戻し、check.yml の雛形も `check-bun.yml` に戻す。

## 3. ラベルを揃える

先に改名する。旧名だけがあるときに限り PATCH で改名し、Issue に付いた履歴を保つ。新旧両方あるときは旧名を残し、報告に書く。

```sh
gh api -X PATCH repos/O/R/labels/needs-input -f new_name=needs-info
gh api -X PATCH 'repos/O/R/labels/status%3Aready' -f new_name=ready
```

次に 8 種を揃える。一致するものは触らない。`audit:*` は監査ループを作らないときも揃える (後から Routine だけを足せるように)。

```sh
gh api -X POST repos/O/R/labels -f name=<name> -f color=<色> -f description=<説明>   # ないもの
gh api -X PATCH repos/O/R/labels/<name> -f color=<色> -f description=<説明>        # 色か説明が違うもの
```

| ラベル           | 色       | 説明                                      |
| ---------------- | -------- | ----------------------------------------- |
| `ready`          | `0e8a16` | 整理済み。開発ループが実装してよい        |
| `needs-info`     | `d876e3` | 質問中。答えは Polaris の質問タスクに書く |
| `split`          | `fbca04` | 小さな Issue に分割した元。閉じるのは人   |
| `hold`           | `e4e669` | 人の判断待ち。ループは触らない            |
| `human`          | `0e8a16` | 人がやる Issue。ループは触らない          |
| `audit:uiux`     | `c5def5` | UI/UX 監査係が起票した                    |
| `audit:security` | `b60205` | セキュリティ監査係が起票した              |
| `audit:refactor` | `bfdadc` | リファクタリング監査係が起票した          |

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
- `.claude/agents/` と `.claude/skills/`: `templates/dot-claude/` の下のファイルを、同じ相対パスに置く。既にあるファイルは置かない (中身が違っても上書きしない)。
  中身はサブエージェント 6 つと、Routine が呼ぶスキル 5 つ。
  監査ループを作らないときも置く。

  ```sh
  tpl=~/.claude/skills/polaris-setup/templates/dot-claude
  (cd "$tpl" && find . -type f) | while read -r f; do
    [ -e ".claude/$f" ] || { mkdir -p ".claude/$(dirname "$f")"; cp "$tpl/$f" ".claude/$f"; }
  done
  ```

- `.github/workflows/check.yml`: 手順 1 の雛形をコピーする。`# {{CHECK_STEPS}}` の行は、検査コマンド 1 つにつき `- run: <コマンド>` 1 行に置き換える。
- `.claude/skills/polaris-dev/reference/repo.md` はセットアップでは作らない。固有の手順が要るときに人が書く。

置換の規則は次のとおり。

- `{{REPO}}` は `O/R`。
- `{{BASE}}` は `vite.config.*` の `base` の値 (無ければ `/`)。手順 4b の `playwright.config.ts` にだけ出てくる。
- `{{CHECK}}` と `{{INSTALL}}` は、コマンドをコードスパンで囲み「、」でつなぐ。
- `<default>` が `main` でなければ、雛形と指示文の `main` をそのブランチ名に置き換える。
- 置換するのは今回置いたファイルだけ。既にあったファイルは触らない。
- 置換後に `{{` が残っていないことを確かめる。GitHub Actions の式 (`${{ ... }}`) は除く。

  ```sh
  grep -rn '{{' CLAUDE.md AGENTS.md .github .claude playwright.config.ts 2>/dev/null | grep -v '\${{'
  ```

手順 4b に進む。commit は手順 4b の最後でまとめて行う。

## 4b. 品質の土台を入れる

手順 2 の問 6 で「入れる」を選んだときだけ行う。同じ worktree で続ける。
雛形は `templates/quality/` にあり、置き先と同じ相対パスで並んでいる。

1. ないものだけ置く。既にあるファイルは置かない。
   `biome.json`、`.storybook/main.ts`、`.storybook/preview.ts`、`playwright.config.ts`、`playwright.vrt.config.ts`、`tsconfig.tooling.json`、`vrt/stories.spec.ts`、`.github/workflows/vrt-update.yml`。
   check.yml は手順 4 で `quality/.github/workflows/check.yml` から置いてある。
2. `.storybook/preview.ts` の CSS の import を、`src/main.tsx` などのエントリが読む全体 CSS に合わせる。全体 CSS が無ければ import の行を消す。
3. `package.json` の `scripts` に、`templates/quality/package-scripts.json` のキーを無いものだけ足す。既にあるキーは値が違っても変えない。
4. 開発用の依存を足し、lockfile を更新する。版は polaris-mobile で動かしたものに揃える。

   ```sh
   bun add -d @biomejs/biome@2.6.4 @playwright/test@1.64.1 storybook@^10.6.5 @storybook/react-vite@^10.6.5 @types/node@^24.19.2
   ```

5. `.gitignore` に `storybook-static`、`playwright-report`、`test-results` を無いものだけ足す。
6. CLAUDE.md の「守ること」に「ランタイムの依存を足さない。開発用 (検査、Storybook、テスト) は可」の趣旨の行が無ければ、節の末尾に足す。節が無ければ、その 1 行だけで `## 守ること` を作る。
7. `bun run format` で整形してから `bun run check` を通す。lint が既存コードで落ちたら、`biome check --write .` で直せる範囲だけ直す。手で直す必要が残れば、そのルールを `biome.json` で `off` にせず、報告の「人の作業」に書く。

story と E2E の本体はリポジトリ固有なので置かない。
`check:e2e` と `check:vrt` は `--pass-with-no-tests` 付きなので、無くても CI は落ちない。

変更があれば、手順 4 と合わせて 1 つにまとめて commit する。メッセージは `chore: Polaris の開発ループ用の部品を入れる`。
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

手順 2 の問 4 で「作らない」を選んだときは作らない。
問 5 で「作らない」を選んだときは、監査係 3 本を作らない。
手順 1 で同じリポジトリ・同じ役割の Routine が見つかったものは作らず、その URL を報告する。

Routine は clone した main の `.claude/skills/` と `.claude/agents/` を読む。
手順 4 の PR がまだマージされていなければ、`enabled` を `false` で作る。
報告の「人の作業」には「マージ後の有効化」を書く。

| 役割                   | 指示文の雛形               | `name`                                            | `cron_expression` (UTC) |
| ---------------------- | -------------------------- | ------------------------------------------------- | ----------------------- |
| 開発係                 | `routine-dev-loop.md`      | `<R> 開発係 (毎時 7-24 JST)`                      | `0 0-15,22,23 * * *`    |
| レビュー係             | `routine-review-loop.md`   | `<R> レビュー係 (毎時 :40 7-24 JST)`              | `40 0-15,22,23 * * *`   |
| UI/UX 監査係           | `routine-uiux-loop.md`     | `<R> UI/UX 監査係 (3 日おき 21:15 JST)`           | `15 12 */3 * *`         |
| セキュリティ監査係     | `routine-security-loop.md` | `<R> セキュリティ監査係 (2 日おき 20:15 JST)`     | `15 11 */2 * *`         |
| リファクタリング監査係 | `routine-refactor-loop.md` | `<R> リファクタリング監査係 (2 日おき 22:15 JST)` | `15 13 */2 * *`         |

開発係とレビュー係の時間帯は手順 2 の問 3 に合わせる。既定から変えたときは、`name` の括弧内と `cron_expression` の時のフィールドを揃えて変える (分は 0 と 40 のまま)。
監査係 3 本は時刻をずらしてあるので変えない。

各雛形を手順 4 と同じ規則で置換し、全文を指示文にする。
RemoteTrigger の `create` に次の body を 1 本ずつ渡す。`uuid` は Routine ごとに新しい小文字の v4 UUID を作って入れる。
`allowed_tools` の `Agent` と `Skill` は外さない。スキルの実行とサブエージェントへの委任に要る。

```json
{
  "name": "<表の name>",
  "cron_expression": "<表の cron_expression>",
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
        "allowed_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "Skill"],
        "model": "claude-opus-5-5",
        "sources": [{ "git_repository": { "url": "https://github.com/O/R" } }]
      }
    }
  }
}
```

環境 `env_018RTHQZ1mJG47167UUSL7LZ` は「Polaris」。
作成後に `get` で `name`・`cron_expression`・`enabled`・`sources`・`allowed_tools`・指示文の先頭行を確かめる。
報告する URL は `https://claude.ai/code/routines/<trigger_id>`。

## 7. 報告する

15 行以内で次を書く。

- やったこと: ラベル (作成・改名・更新の数)、置いたファイル (`.claude/` は数だけ)、2 つの PR の URL、Routine の役割と URL (最大 5 本)。
- 触らなかったもの: 既にあったため飛ばしたファイル・ラベル・Routine。
- 人の作業: 2 つの PR のマージと、`enabled: false` で作った Routine の有効化。
  CLAUDE.md の「守ること」と AGENTS.md の「必ず見るもの」の見直し。
  `polaris-refactor` の規約 (`style.md`) の差し替え。
  品質の土台を入れたときは、story を 1 つ以上書く、E2E の煙テストを書く、マージ後に `vrt-update` を main で 1 回回す。
- 残った不一致: 新旧両方あるラベル、`github` の値の違い、雛形のないスタック。

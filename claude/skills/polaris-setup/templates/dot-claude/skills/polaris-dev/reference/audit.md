# 監査ループの共通手順

`polaris-uiux`、`polaris-security`、`polaris-refactor` が使う。
`<kind>` は `uiux`、`security`、`refactor` のどれか。監査役は `<kind>-auditor`。

出力は Issue だけ。コードの修正、ブランチと PR の作成はしない。
1 回の実行で起票は 3 件まで。open の監査 Issue が 6 件以上あるときは起票しない。

## 0. 積み残しを見る

open の監査 Issue (種類を問わず `audit:` で始まるラベル) を数える。

```sh
gh api --paginate 'repos/{{REPO}}/issues?state=open&per_page=100' \
  --jq '[.[] | select(.pull_request == null) | select(any(.labels[].name; startswith("audit:")))] | length'
```

6 件以上なら今回は起票しない。「積み残し N 件のため見送り」と報告して終わる。
開発係が消化する速さを超えて増やさないための上限。

## 1. 既存のキーを集める

open と closed の両方から、過去に起票したキーを集める。

```sh
gh api --paginate 'repos/{{REPO}}/issues?state=all&labels=audit:<kind>&per_page=100' \
  --jq '.[] | (.body // "") | capture("polaris-audit: <kind> key=(?<k>[^ ]+) -->").k'
```

閉じた Issue のキーも二度と起票しない。人が閉じたものは「直さない」と決めたものとして扱う。

## 2. 候補を集める

`<kind>-auditor` に、集めたキーの一覧を「既存のキー」として渡し、候補をもらう。
主セッションはコードを探索しない。候補の根拠が怪しいときだけ、その `file:line` を Read で確かめる。

## 3. 判断する

候補ごとに AGENTS.md の基準で `頻度 N × 影響 M = 積` を付ける。

- 積が 5 未満なら起票しない。
- キーが既存の一覧にあれば起票しない。今回の候補同士で重なるものは 1 件にまとめる。
- 残りを積の大きい順に 3 件まで起票する。

起票するものは、次のどちらかに分ける。

- `ready`: 直し方が機械的で、PR 1 本に収まる。開発係がそのまま実装する。
- `needs-info`: 設計の判断を含む、画面の振る舞いが変わる、または複数の PR に分かれる。選択肢 (A/B/C で 3 つまで) を添える。

迷ったら `needs-info` にする。`ready` は開発係が実装し、レビューを通れば自動でマージされる。

## 4. 起票する

本文はファイルに書いてから `gh api -X POST repos/{{REPO}}/issues` で作る。
ラベルは `audit:<kind>` と、`ready` か `needs-info` のどちらか 1 つ。

```markdown
<!-- polaris-audit: <kind> key=<キー> -->

頻度 N × 影響 M = 積

## 何が起きるか

再現手順 (どう操作すると、どうなるか) を 1〜3 行。

## 根拠

- `path:line` — 要旨

## 直し方

ready なら手順を 1〜3 行。needs-info なら「決めること」と選択肢 A/B/C。

## 完了の条件

- 確かめられる形で 1〜3 行
```

1 行目の目印は書式を変えない。キーは監査役が返した `<項目 ID>:<パス>` をそのまま使う。
`needs-info` のときは、同じ質問を Issue のコメントとしても 1 つ書く。整理ループがコメントから Polaris の質問タスクを作る。

## やらないこと

- コードの編集、ブランチ、commit、push、PR。
- 既存の Issue の書き換え、ラベルの付け替え、クローズ。
- 1 回の実行で 4 件以上の起票。

## 報告

起票した Issue の番号・キー・付けたラベル (`ready` / `needs-info`)、見送った候補の数を 5 行以内で書く。

---
name: polaris-refactor
description: Polaris のリファクタリング監査係の 1 回分。{{REPO}} のコードをリファクタリングのチェックリストで見て、頻度 × 影響が 5 以上の問題を `audit:refactor` の Issue として 3 件まで起票する。Routine のリファクタリング監査係から `/polaris-refactor` で呼ばれる。
---

# polaris-refactor

リファクタリングの問題を見つけて Issue にする。コードは直さない。

主セッションは既存のキーを集め、候補を判定し、起票する。
コードを歩いて候補を集めるのは `refactor-auditor` に出す。

## 手順

1. `.claude/skills/polaris-dev/reference/gh-rest.md` と `AGENTS.md` を読む。
2. `.claude/skills/polaris-dev/reference/audit.md` の手順に、`<kind>` = `refactor` で従う。
3. 監査役に渡す観点は `.claude/skills/polaris-refactor/reference/style.md`。主セッションはこのファイルを読まなくてよい。

## この監査に固有のこと

- 外から見た振る舞いを変えないものだけを扱う。振る舞いが変わるなら、それは別の種類の Issue なので起票しない。
- 頻度は「その箇所を今後触る見込み」、影響は「触ったときに壊しやすさ・直す手間がどれだけ増えるか」で読む。AGENTS.md の基準で 5 未満になりやすいので、無理に件数を埋めない。
- テストの無い純粋関数にテストを足す Issue は、振る舞いを固定するので `ready` にしてよい。

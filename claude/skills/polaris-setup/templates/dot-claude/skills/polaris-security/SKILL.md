---
name: polaris-security
description: Polaris のセキュリティ監査係の 1 回分。{{REPO}} のコードをセキュリティのチェックリストで見て、頻度 × 影響が 5 以上の問題を `audit:security` の Issue として 3 件まで起票する。Routine のセキュリティ監査係から `/polaris-security` で呼ばれる。
---

# polaris-security

セキュリティの問題を見つけて Issue にする。コードは直さない。

主セッションは既存のキーを集め、候補を判定し、起票する。
コードを歩いて候補を集めるのは `security-auditor` に出す。

## 手順

1. `.claude/skills/polaris-dev/reference/gh-rest.md` と `AGENTS.md` を読む。
2. `.claude/skills/polaris-dev/reference/audit.md` の手順に、`<kind>` = `security` で従う。
3. 監査役に渡す観点は `.claude/skills/polaris-security/reference/checklist.md`。主セッションはこのファイルを読まなくてよい。

## この監査に固有のこと

- リポジトリが public なら、Issue は誰でも読める。本文には経路と直し方までを書き、悪用の手順そのもの (実際のトークン、攻撃文字列の完成形) は書かない。
- 実際に秘密 (PAT、鍵) が commit 履歴や公開物に出ているのを見つけたら、起票せず、報告の 1 行目に「人の対応が要る」として場所だけを書いて終わる。失効は人がやる。
- 依存の既知脆弱性は、修正版への更新だけで済むなら `ready`、メジャー更新や置き換えが要るなら `needs-info`。

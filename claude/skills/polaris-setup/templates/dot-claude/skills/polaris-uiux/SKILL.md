---
name: polaris-uiux
description: Polaris の UI/UX 監査係の 1 回分。{{REPO}} のコードを UI/UX のチェックリストで見て、頻度 × 影響が 5 以上の問題を `audit:uiux` の Issue として 3 件まで起票する。Routine の UI/UX 監査係から `/polaris-uiux` で呼ばれる。
---

# polaris-uiux

UI/UX の問題を見つけて Issue にする。コードは直さない。

主セッションは既存のキーを集め、候補を判定し、起票する。
コードを歩いて候補を集めるのは `uiux-auditor` に出す。

## 手順

1. `.claude/skills/polaris-dev/reference/gh-rest.md` と `AGENTS.md` を読む。
2. `.claude/skills/polaris-dev/reference/audit.md` の手順に、`<kind>` = `uiux` で従う。
3. 監査役に渡す観点は `.claude/skills/polaris-uiux/reference/checklist.md`。主セッションはこのファイルを読まなくてよい。

## この監査に固有のこと

- ブラウザでの目視はできない。コードから再現手順を書けるものだけを扱う。
- 画面や機能を増やす提案は `needs-info` にする。CLAUDE.md が画面の数を決めているときは、それを超える案を出さない。
- 色・余白・文言の好みは起票しない。チェックリストの項目に当たるものだけを扱う。

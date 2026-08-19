#!/usr/bin/env bash
# リポジトリを ghq 配下に clone/fetch するだけの入口。
set -euo pipefail

REPO_SLUG="Hirayama61/mise-dotfiles"

if ! command -v git >/dev/null 2>&1; then
  echo "git が見つかりません。先に Xcode Command Line Tools を入れてください:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

if command -v ghq >/dev/null 2>&1; then
  ghq_root=$(ghq root | head -1)
else
  ghq_root="${GHQ_ROOT:-$HOME/ghq}"
fi

dest="$ghq_root/github.com/$REPO_SLUG"

if [ -d "$dest/.git" ]; then
  git -C "$dest" fetch --quiet origin
  clone_detail="既にありました(更新を取得)"
else
  git clone --quiet "https://github.com/$REPO_SLUG.git" "$dest"
  clone_detail="取得しました"
fi

short_dest="${dest/#$HOME/~}"
next_command="cd $short_dest && ./bin/bootstrap.sh"

printf '\n   ✓ %-14s%s\n' 'mise-dotfiles' "$clone_detail"
printf '   ✓ %-14s%s\n\n' 'path' "$short_dest"
printf '   Next Action\n\n'
printf '     %-24s%s\n\n' "cd $short_dest" ''
printf '     %-24s%s\n\n' './bin/bootstrap.sh' 'commit / push できる状態まで環境を整える'

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s\n' "$next_command" | pbcopy
  printf '   📋 クリップボードに入れました\n\n'
fi

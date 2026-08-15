#!/usr/bin/env bash
# リポジトリを ghq 配下にクローンするためのスクリプト。
# このスクリプトを実行するだけでは、環境は変更されない。
# 環境の変更は bin/bootstrap.sh が担当。
set -euo pipefail

REPO_SLUG="Hirayama61/mise-dotfiles"

if ! command -v git >/dev/null 2>&1; then
  echo "git が見つかりません。先に Xcode Command Line Tools を入れてください:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

# ghq_root 配下にリポジトリを clone（デフォルト: $HOME/ghq）
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

. "$dest/bin/lib/palette.sh"
. "$dest/bin/lib/ui.sh"

short_dest="${dest/#$HOME/~}"

ui_banner 'リポジトリの取得だけを行いました。環境はまだ変えていません'
ui_status ok 'mise-dotfiles' "$clone_detail"
ui_status ok 'path' "$short_dest"

ui_section 'Next Action'
ui_next_step "cd $short_dest" ''
ui_next_step './bin/bootstrap.sh' 'commit / push できる状態まで環境を整える'
printf '\n'
ui_clipboard "cd $short_dest && ./bin/bootstrap.sh"
printf '\n'

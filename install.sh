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
  # fetch だけでは作業ツリーが古いままになり、この直後に source する bin/lib と
  # Next Action で案内する bootstrap.sh が最新にならない。
  # 失敗の理由はローカルの変更に限らず、通信・認証・upstream 未設定でも起きる。
  # 原因を決めつけず、git のエラーをそのまま見せる。
  if git -C "$dest" pull --ff-only --quiet; then
    clone_detail="既にありました(最新に更新)"
  else
    clone_detail="既にありました(更新できず。上のエラーを確認)"
  fi
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

# bootstrap は子プロセスなので、そこで Homebrew を入れても親シェルの PATH は変わらない。
# 人間が叩く 1 本のコマンドとして繋ぎ、呼び出し元の端末で eval を走らせる。
# shellcheck disable=SC2016  # 人間の端末で評価させる文字列なので、ここでは展開しない
homebrew_activation_command='eval "$(/opt/homebrew/bin/brew shellenv)"'

ui_section 'Next Action'
ui_next_step "cd $short_dest" ''
ui_next_step './bin/bootstrap.sh' 'commit / push できる状態まで環境を整える'
ui_next_step "$homebrew_activation_command" 'Homebrew の PATH をこの端末に通す'
printf '\n'
ui_clipboard "cd $short_dest && ./bin/bootstrap.sh && $homebrew_activation_command"
printf '\n'

#!/usr/bin/env bash
# curl で実行する入口。git の確認、リポジトリの取得・更新、mise の導入を行う。
# ツールと設定の適用は mise run setup、Git 設定(gh 認証・git identity)は任意の
# mise run git-setup が担当する。
#
# curl | bash では起動できない。stdin がスクリプト本文になり、ui_confirm がそれを読んでしまう。
set -euo pipefail

REPO_SLUG="Hirayama61/mise-dotfiles"
# https://mise.run の既定の配置先。素の macOS では PATH に無い。
MISE_BIN="$HOME/.local/bin/mise"

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
  # fetch だけでは作業ツリーが古いままになり、この直後に source する bin/lib が
  # 最新にならない。
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

# スピナー表示中に中断されるとカーソルが消えたままになる。
trap ui_show_cursor EXIT

short_dest="${dest/#$HOME/~}"

# "<tool> version X.Y.Z (...)" の形式で名乗るツールからバージョンだけ取り出す。
tool_version() {
  "$1" --version 2>/dev/null | head -1 | awk '{print $3}'
}

ensure_mise() {
  # 導入済みの端末から起動されても、この子プロセスの PATH に ~/.local/bin は無いことがある。
  # 気づかずインストーラへ進むと再ダウンロードが無駄に走る。
  export PATH="$HOME/.local/bin:$PATH"

  if ! command -v mise >/dev/null 2>&1; then
    # インストーラは sudo も対話も求めず、~/.local/bin/mise を置くだけ。
    ui_run 'mise' '導入しています' sh -c 'curl -fsSL https://mise.run | sh'
  fi

  # 初回はこのリポジトリの mise.toml が未信頼で確認が入るため、先に trust しておく。
  mise trust "$dest/mise.toml" >/dev/null 2>&1 || true
  ui_status ok 'mise' "$(mise --version 2>/dev/null | awk '{print $1}')"
}

# 人間が端末で打つ mise のコマンド名。
# 入れたばかりの端末では ~/.local/bin が PATH に無く、裸の mise は見つからない。
# mise run setup が shell activation を書くまでは、パス付きで案内する。
mise_command() {
  if [ "$(command -v mise)" = "$MISE_BIN" ]; then
    printf '~/.local/bin/mise'
  else
    printf 'mise'
  fi
}

ui_banner 'リポジトリの取得と mise の導入まで'

ui_section 'リポジトリ'
ui_status ok 'mise-dotfiles' "$clone_detail"
ui_status ok 'path' "$short_dest"

ui_section 'ツール'
ui_status ok 'git' "$(tool_version git)"
ensure_mise

ui_section 'Git 設定'
ui_note 'gh の認証と git identity の設定は、この端末から commit / push する場合だけ必要です。'
printf '\n'
if ui_confirm 'Git 設定へ進みますか'; then
  next_command="$(mise_command) run git-setup"
  next_description='commit / push できる状態にする'
else
  next_command="$(mise_command) run setup"
  next_description='リポジトリが管理するツールと設定を適用する'
  printf '\n'
  ui_note "Git 設定は後から $(mise_command) run git-setup で実行できます。"
fi

ui_ready '土台が揃いました'
ui_section 'Next Action'
ui_next_step "cd $short_dest" ''
ui_next_step "$next_command" "$next_description"
printf '\n'
ui_clipboard "cd $short_dest && $next_command"
printf '\n'

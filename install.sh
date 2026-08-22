#!/usr/bin/env bash
# curl で実行する入口。リポジトリの取得と、土台ツール(Homebrew・mise・Bun)の導入を行う。
# Git 設定(gh 認証・git identity)は任意タスクの mise run git-setup が担当する。
#
# curl | bash では起動できない。stdin がスクリプト本文になり、Homebrew インストーラの
# Enter 確認とこのスクリプトの ui_confirm がそれを読んでしまう。
set -euo pipefail

REPO_SLUG="Hirayama61/mise-dotfiles"
HOMEBREW_BIN=/opt/homebrew/bin/brew

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

# インストーラは PATH を通さないので、この実行中に使えるよう自分で読み込む。
activate_homebrew() {
  eval "$("$HOMEBREW_BIN" shellenv)"
}

ensure_homebrew() {
  # インストーラが作る /etc/paths.d/homebrew は新しいシェルにしか効かない。
  # 導入済みの端末から起動されたこのプロセスでは PATH に無いことがある。
  # 気づかずインストーラへ進むと、再ダウンロードと sudo 要求が無駄に走る。
  if ! command -v brew >/dev/null 2>&1 && [ -x "$HOMEBREW_BIN" ]; then
    activate_homebrew
  fi

  if ! command -v brew >/dev/null 2>&1; then
    # sudo を求めるので隠せない。境界だけ示して生ログを流す。
    #
    # NONINTERACTIVE は付けない。付けると権限確認が sudo -n になり、パスワードを
    # 要求する端末では abort する。代わりに確認の Enter 待ちを受け入れる。
    # sudo -v は NOPASSWD が設定されていてもパスワードを求めるので、
    # どちらの端末でも 1 度は入力が要る。
    ui_external_begin 'Homebrew installer'
    /bin/bash -c \
      "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ui_external_end

    activate_homebrew
  fi

  ui_status ok 'Homebrew' "$(brew --version 2>/dev/null | head -1 | awk '{print $2}')"
}

ensure_mise() {
  if ! command -v mise >/dev/null 2>&1; then
    ui_run 'mise' '導入しています' brew install --quiet mise
  fi

  ui_status ok 'mise' "$(mise --version 2>/dev/null | awk '{print $1}')"
}

ensure_bun() {
  # mise.toml の [tools] に従って Bun を入れる。導入済みなら mise install は何もしない。
  # 初回はこのリポジトリの mise.toml が未信頼で確認が入るため、先に trust しておく。
  mise trust "$dest/mise.toml" >/dev/null 2>&1 || true
  ui_run 'Bun' '導入しています' mise -C "$dest" install
  ui_status ok 'Bun' "$(mise -C "$dest" exec -- bun --version 2>/dev/null)"
}

ui_banner 'リポジトリの取得と土台ツールの導入まで'

ui_section 'リポジトリ'
ui_status ok 'mise-dotfiles' "$clone_detail"
ui_status ok 'path' "$short_dest"

ui_section 'ツール'
ui_status ok 'git' "$(tool_version git)"
ensure_homebrew
ensure_mise
ensure_bun

ui_section 'Git 設定'
ui_note 'gh の認証と git identity の設定は、この端末から commit / push する場合だけ必要です。'
printf '\n'
if ui_confirm 'Git 設定へ進みますか'; then
  next_command='mise run git-setup'
  next_description='commit / push できる状態にする'
else
  next_command='mise run setup'
  next_description='リポジトリが管理するツールと設定を適用する'
  printf '\n'
  ui_note 'Git 設定は後から mise run git-setup で実行できます。'
fi

# このスクリプトは子プロセスなので、中で Homebrew を入れても親シェルの PATH は変わらない。
# 人間が叩く 1 本のコマンドとして繋ぎ、呼び出し元の端末で eval を走らせる。
# shellcheck disable=SC2016  # 人間の端末で評価させる文字列なので、ここでは展開しない
homebrew_activation_command='eval "$(/opt/homebrew/bin/brew shellenv)"'

ui_ready '土台が揃いました'
ui_section 'Next Action'
ui_next_step "cd $short_dest" ''
ui_next_step "$homebrew_activation_command" 'Homebrew の PATH をこの端末に通す'
ui_next_step "$next_command" "$next_description"
printf '\n'
ui_clipboard "cd $short_dest && $homebrew_activation_command && $next_command"
printf '\n'

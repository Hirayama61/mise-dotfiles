#!/usr/bin/env bash
# このリポジトリを開発するための Git 周りの環境構築を行うスクリプト。
# fish や nvim といった実際に使うツールのインストールや設定は mise run setup が担当する。
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$repo_root/bin/lib/palette.sh"
. "$repo_root/bin/lib/ui.sh"

# スピナー表示中に中断されるとカーソルが消えたままになる。
trap ui_show_cursor EXIT

HOMEBREW_BIN=/opt/homebrew/bin/brew

# "<tool> version X.Y.Z (...)" の形式で名乗るツールからバージョンだけ取り出す。
tool_version() {
  "$1" --version 2>/dev/null | head -1 | awk '{print $3}'
}

require_git() {
  if ! command -v git >/dev/null 2>&1; then
    ui_note 'git がありません。Xcode Command Line Tools を入れてから再実行してください:'
    ui_note '  xcode-select --install'
    exit 1
  fi

  ui_status ok 'git' "$(tool_version git)"
}

# インストーラは PATH を通さないので、この実行中に使えるよう自分で読み込む。
activate_homebrew() {
  eval "$("$HOMEBREW_BIN" shellenv)"
}

ensure_homebrew() {
  # /etc/paths に /opt/homebrew/bin は入らないので、導入済みでも PATH に無いことがある。
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

# ghq と gh はリポの取得と認証に必要なため mise run setup ではなくこのタイミングで設定を行う。
ensure_repo_tools() {
  local missing=()
  command -v ghq >/dev/null 2>&1 || missing+=(ghq)
  command -v gh >/dev/null 2>&1 || missing+=(gh)

  if [ ${#missing[@]} -gt 0 ]; then
    ui_run 'mise' "${missing[*]} を導入しています" mise use --global "${missing[@]}"
    export PATH="${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims:$PATH"
  fi

  ui_status_child ok 'ghq' "$(tool_version ghq)"
  ui_status_child ok 'gh' "$(tool_version gh)"
}

ensure_github_auth() {
  if ! gh auth status >/dev/null 2>&1; then
    ui_note 'GitHub の認証が必要です。ブラウザが開きます。'
    printf '\n'
    gh auth login --hostname github.com --git-protocol https --web
    printf '\n'
  fi

  ui_status ok 'gh auth' "$(gh api user --jq .login 2>/dev/null || echo '認証済み')"
}

# 空入力を既定値で埋められない項目を、値が入るまで聞き直す。
ask_until_answered() {
  local label=$1 default=$2 answer=""

  while [ -z "$answer" ]; do
    answer=$(ui_ask "$label" "$default")
  done

  printf '%s' "$answer"
}

print_gitconfig_preview() {
  local name=$1 email=$2

  printf '\n'
  ui_color "$PANDA_SUBTLE"
  printf '   ~/.gitconfig に書きます\n\n'
  printf '     [user]\n'
  printf '         name  = '
  ui_color "$PANDA_FG"
  printf '%s\n' "$name"
  ui_color "$PANDA_SUBTLE"
  printf '         email = '
  ui_color "$PANDA_FG"
  printf '%s\n\n' "$email"
  ui_reset
}

# git は ~/.gitconfig が存在すると ~/.config/git/config を読まなくなる。
# ここで書く値は ~/.gitconfig に入るので、後から共有設定を include で足しても
# include より後ろに残り、端末固有の値として勝ち続ける。
#
# commit には name と email の両方が要る。片方でも欠けていれば対話に入り、
# 残っている方は既定値として提示するので Enter で維持できる。
ensure_git_identity() {
  local current_name current_email
  current_name=$(git config --get user.name || true)
  current_email=$(git config --get user.email || true)

  if [ -n "$current_name" ] && [ -n "$current_email" ]; then
    ui_status kept 'user.name' "$current_name"
    ui_status kept 'user.email' "$current_email"
    printf '\n'
    ui_note '既に設定済みなので変更しません。'
    return
  fi

  local login user_id suggested_name noreply name email
  login=$(gh api user --jq .login 2>/dev/null || true)
  user_id=$(gh api user --jq .id 2>/dev/null || true)
  suggested_name=$(gh api user --jq '.name // .login' 2>/dev/null || true)

  ui_note 'commit に必要な identity が未設定です。'
  ui_note 'Enter で [ ] 内の候補を採用します。変えるなら入力してください。'

  noreply=""
  if [ -n "$user_id" ] && [ -n "$login" ]; then
    noreply="${user_id}+${login}@users.noreply.github.com"
    ui_note 'email の既定は GitHub がアドレスを隠す noreply 形式です。'
  fi
  printf '\n'

  name=$(ask_until_answered 'name' "${current_name:-${suggested_name:-$login}}")
  email=$(ask_until_answered 'email' "${current_email:-$noreply}")

  print_gitconfig_preview "$name" "$email"

  if ! ui_confirm 'この内容で書き込みますか'; then
    printf '\n'
    ui_note '中止しました。commit する前に git config --global で設定してください。'
    return
  fi

  git config --global user.name "$name"
  git config --global user.email "$email"

  printf '\n'
  ui_status ok 'user.name' "$name"
  ui_status ok 'user.email' "$email"
}

print_next_steps() {
  ui_ready 'リポを編集して push できます'
  ui_section 'Next Action'
  ui_next_step 'mise run setup' 'リポジトリが管理するツールを揃える'
  ui_next_step 'claude login' 'Claude Code の認証(未認証なら)'
  printf '\n'
  ui_clipboard 'mise run setup'
  printf '\n'
}

ui_banner 'commit / push できる状態まで'

ui_section 'ツール'
require_git
ensure_homebrew
ensure_mise
ensure_repo_tools

ui_section 'GitHub'
ensure_github_auth

ui_section 'git identity'
ensure_git_identity

print_next_steps

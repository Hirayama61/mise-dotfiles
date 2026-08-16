# shellcheck shell=bash
# install.sh / bootstrap.sh の表示部品。
# palette.sh を先に読み込んでおくこと。
#
# 端末以外へ出力する時と NO_COLOR 指定時はエスケープを出さない。
# ログやパイプに制御文字が混ざると読めなくなるため。
#
# グラデーションは文字単位で色を変えるので、C ロケールだとバイト単位に割れて
# 罫線が壊れる。読み込み時に UTF-8 を確保しておく。
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  UI_USES_COLOR=1
else
  UI_USES_COLOR=0
fi

ui_color() {
  [ "$UI_USES_COLOR" = 1 ] || return 0
  local red green blue
  read -r red green blue <<<"$1"
  printf '\033[38;2;%d;%d;%dm' "$red" "$green" "$blue"
}

ui_reset() {
  [ "$UI_USES_COLOR" = 1 ] || return 0
  printf '\033[0m'
}

# 出力が一度に流れると目線が追いつかないので、行ごとに間を置く。
# 0 を渡せば止まらない。端末以外へ出力する時は元から待たない。
UI_LINE_DELAY="${UI_LINE_DELAY:-0.06}"

ui_pause_line() {
  [ "$UI_USES_COLOR" = 1 ] || return 0
  [ "$UI_LINE_DELAY" = 0 ] && return 0
  sleep "$UI_LINE_DELAY"
}

# 1 文字ずつ色を送って左右にグラデーションをかける。
ui_gradient() {
  local text=$1 from=$2 to=$3

  if [ "$UI_USES_COLOR" != 1 ]; then
    printf '%s' "$text"
    return
  fi

  local from_red from_green from_blue to_red to_green to_blue
  read -r from_red from_green from_blue <<<"$from"
  read -r to_red to_green to_blue <<<"$to"

  local length=${#text}
  [ "$length" -eq 0 ] && return

  local last=$((length > 1 ? length - 1 : 1))
  local i
  for ((i = 0; i < length; i++)); do
    printf '\033[38;2;%d;%d;%dm%s' \
      $((from_red + (to_red - from_red) * i / last)) \
      $((from_green + (to_green - from_green) * i / last)) \
      $((from_blue + (to_blue - from_blue) * i / last)) \
      "${text:i:1}"
  done
  ui_reset
}

ui_banner() {
  local subtitle=$1

  printf '\n  '
  ui_gradient '┏┳┓╻┏━┓┏━╸   ╺┳┓┏━┓╺┳╸┏━╸╻╻  ┏━╸┏━┓' "$PANDA_PINK" "$PANDA_PURPLE_LIFT"
  ui_pause_line
  printf '\n  '
  ui_gradient '┃┃┃┃┗━┓┣╸     ┃┃┃ ┃ ┃ ┣╸ ┃┃  ┣╸ ┗━┓' "$PANDA_PURPLE_LIFT" "$PANDA_BLUE_LIFT"
  ui_pause_line
  printf '\n  '
  ui_gradient '╹ ╹╹┗━┛┗━╸   ╺┻┛┗━┛ ╹ ╹  ╹┗━╸┗━╸┗━┛' "$PANDA_BLUE_LIFT" "$PANDA_MINT"
  ui_pause_line
  printf '\n\n'

  ui_color "$PANDA_GRAY_LIFT"
  printf '  %s\n\n' "$subtitle"
  ui_reset
  ui_pause_line
}

ui_section() {
  printf '\n'
  ui_color "$PANDA_SUBTLE"
  printf '   %s\n\n' "$1"
  ui_reset
  ui_pause_line
}

# $1 は ok(揃っている) / kept(既存があるので触らなかった)
#
# ラベル幅はインデントの深さと足して揃えてあり、親子で detail の開始列が一致する。
ui_status_line() {
  local indent=$1 label_width=$2 state=$3 label=$4 detail=$5

  printf '%s' "$indent"

  case "$state" in
  ok)
    ui_color "$PANDA_MINT"
    printf '✓ '
    ;;
  kept)
    ui_color "$PANDA_SUBTLE"
    printf '· '
    ;;
  esac

  ui_color "$PANDA_FG"
  printf "%-${label_width}s" "$label"
  ui_color "$PANDA_GRAY_LIFT"
  printf '%s\n' "$detail"
  ui_reset
  ui_pause_line
}

ui_status() {
  ui_status_line '   ' 14 "$@"
}

# 直前の行にぶら下げる。mise が入れたツールのような内訳を出す時に使う。
ui_status_child() {
  ui_status_line '     ' 12 "$@"
}

ui_note() {
  ui_color "$PANDA_GRAY_LIFT"
  printf '   %s\n' "$1"
  ui_reset
  ui_pause_line
}

UI_SPINNER_FRAMES='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

ui_show_cursor() {
  [ "$UI_USES_COLOR" = 1 ] || return 0
  printf '\033[?25h'
}

# 時間のかかる処理をスピナーで隠して実行する。ログは一時ファイルへ落とし、
# 失敗した時だけ吐き出す。成功時の完了行は呼び出し側が ui_status で出す。
#
# 対話が必要な処理には使えない。標準入出力を奪うので入力できずに固まる。
ui_run() {
  local label=$1 detail=$2
  shift 2

  if [ "$UI_USES_COLOR" != 1 ]; then
    "$@"
    return
  fi

  local log
  log=$(mktemp)

  "$@" >"$log" 2>&1 &
  local worker=$!

  printf '\033[?25l'
  local frame=0
  while kill -0 "$worker" 2>/dev/null; do
    ui_color "$PANDA_MINT"
    printf '\r   %s ' "${UI_SPINNER_FRAMES:frame:1}"
    ui_color "$PANDA_FG"
    printf '%-14s' "$label"
    ui_color "$PANDA_GRAY_LIFT"
    printf '%s' "$detail"
    ui_reset
    frame=$(((frame + 1) % ${#UI_SPINNER_FRAMES}))
    sleep 0.1
  done

  local status=0
  wait "$worker" || status=$?

  printf '\r\033[K'
  ui_show_cursor

  if [ "$status" -ne 0 ]; then
    cat "$log" >&2
    rm -f "$log"
    return "$status"
  fi

  rm -f "$log"
}

# 外部インストーラの生ログを囲って、自前の表示と混ざらないようにする。
# sudo を求める処理は隠せないので、隠さずに境界だけ示す。
ui_external_begin() {
  printf '\n'
  ui_color "$PANDA_SUBTLE"
  printf '   ┄┄┄┄ %s ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n' "$1"
  ui_reset
  ui_pause_line
}

ui_external_end() {
  printf '\n'
  ui_color "$PANDA_SUBTLE"
  printf '   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n'
  ui_reset
  ui_pause_line
}

ui_ready() {
  printf '\n'
  ui_color "$PANDA_MINT"
  printf '   ready.'
  ui_color "$PANDA_GRAY_LIFT"
  printf '  %s\n\n' "$1"
  ui_reset
  ui_pause_line
}

# コマンドが 24 桁に収まらないと説明が直に続いて読めなくなるので、
# 桁が足りない時も最低 2 つは空ける。
ui_next_step() {
  local command_text=$1 description=$2
  local padding=$((24 - ${#command_text}))
  [ "$padding" -lt 2 ] && padding=2

  ui_color "$PANDA_CYAN"
  printf '     %s' "$command_text"
  ui_color "$PANDA_SUBTLE"
  printf '%*s%s\n' "$padding" '' "$description"
  ui_reset
  ui_pause_line
}

# 戻り値を $() で受ける前提なので、プロンプトは stderr へ出す。
# stdout に出すとプロンプトごとキャプチャされ、画面に何も出ないまま入力待ちになり、
# 入力値に ANSI エスケープが混入する。
#
# $() の中で読むと Enter のエコーが画面に届かず、次のプロンプトが同じ行に続く。
# 端末のエコーに頼らず自分で改行する。
ui_ask() {
  local label=$1 default=$2 answer

  {
    ui_color "$PANDA_FG"
    printf '   %-8s' "$label"
    ui_color "$PANDA_SUBTLE"
    printf '[%s] ' "$default"
    ui_color "$PANDA_CYAN"
    printf '> '
    ui_reset
  } >&2

  read -r answer
  printf '\n' >&2
  printf '%s' "${answer:-$default}"
}

ui_confirm() {
  local answer

  ui_color "$PANDA_PINK"
  printf '   %s ' "$1"
  ui_color "$PANDA_SUBTLE"
  printf '[Y/n] '
  ui_reset

  read -r answer
  [ -z "$answer" ] || case "$answer" in [Yy]*) true ;; *) false ;; esac
}

# pbcopy が無い環境(VM の SSH セッション等)でも、コマンド自体は読めるようにする。
ui_clipboard() {
  local command_text=$1

  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s\n' "$command_text" | pbcopy
    ui_color "$PANDA_PINK"
    printf '   📋 '
    ui_color "$PANDA_GRAY_LIFT"
    printf 'クリップボードに入れました\n'
    ui_reset
    ui_pause_line
  fi
}

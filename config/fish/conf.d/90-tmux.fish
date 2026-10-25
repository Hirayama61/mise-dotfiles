# 端末を開いたら tmux のセッション 0 に入る(無ければ作る)。
# exec でシェルを置き換えるので、PATH と mise が揃ったあと、最後に読む。
# tmux の中、エディタ内蔵の端末、対話でないシェルでは何もしない。
if status is-interactive
    and not set -q TMUX
    and not contains -- "$TERM_PROGRAM" vscode zed
    and type -q tmux
    exec tmux new-session -A -s 0
end

# mise。対話シェルでは activate(プロンプトごとに環境を更新)、スクリプトでは shims。
# mise bootstrap の mise_shell_activate は使わない。このファイルは symlink なので、
# mise にブロックを書かせるとリポジトリ側のファイルが書き換わる。
if status is-interactive
    mise activate fish | source
else
    mise activate fish --shims | source
end

# fish の設定。mise-dotfiles の config/fish/config.fish から ~/.config/fish/config.fish へ symlink される。
# fish は対話シェルもスクリプトもこの 1 ファイルを読むので、対話専用の処理は status is-interactive で囲む。
# fish_variables・functions/・completions/ は fish が自分で生成するため、このファイルだけを管理する。

# Homebrew(Apple Silicon)。PATH と MANPATH を通す。
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
end

# mise.run のインストーラが置く ~/.local/bin。下の mise 活性化より先に PATH へ通す。
fish_add_path --global ~/.local/bin

# mise。対話シェルでは activate(プロンプトごとに環境を更新)、スクリプトでは shims。
# mise bootstrap の mise_shell_activate は使わない。このファイルは symlink なので、
# mise にブロックを書かせるとリポジトリ側のファイルが書き換わる。
if status is-interactive
    mise activate fish | source
else
    mise activate fish --shims | source
end

set -gx EDITOR nvim
set -gx VISUAL nvim

if status is-interactive
    starship init fish | source
end

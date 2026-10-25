# Homebrew(Apple Silicon)。PATH と MANPATH を通す。
if test -x /opt/homebrew/bin/brew
    /opt/homebrew/bin/brew shellenv | source
end

# mise.run のインストーラが置く ~/.local/bin。20-mise.fish の活性化より先に PATH へ通す。
fish_add_path --global ~/.local/bin

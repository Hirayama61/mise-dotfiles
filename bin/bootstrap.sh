#!/usr/bin/env bash
# Deno/TypeScript の bootstrap を起動できる状態までだけ整える。
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
HOMEBREW_BIN=/opt/homebrew/bin/brew
homebrew_needs_activation=0

if ! command -v git >/dev/null 2>&1; then
  echo 'git が見つかりません。先に Xcode Command Line Tools を入れてください:' >&2
  echo '  xcode-select --install' >&2
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  printf '\n   ┄┄┄┄ Homebrew installer ┄┄┄┄\n\n'
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  printf '\n   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n'

  eval "$("$HOMEBREW_BIN" shellenv)"
  homebrew_needs_activation=1
fi

if ! command -v mise >/dev/null 2>&1; then
  brew install --quiet mise
fi

export MISE_DOTFILES_HOMEBREW_NEEDS_ACTIVATION="$homebrew_needs_activation"
exec mise exec deno@2 -- deno run --allow-env --allow-run "$repo_root/bin/bootstrap.ts"

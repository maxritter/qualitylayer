#!/usr/bin/env bash
set -euo pipefail

if command -v git-crypt >/dev/null; then
  echo "git-crypt already installed: $(command -v git-crypt)"
  exit 0
fi

if [ "$(uname -s)" = Darwin ]; then
  brew install git-crypt
else
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  bash "$script_dir/install-ubuntu-packages.sh" git-crypt
fi
command -v git-crypt

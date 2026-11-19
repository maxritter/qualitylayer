#!/usr/bin/env bash
set -euo pipefail

playwright=${1:?Pass the locked Playwright CLI}
if checked="$("$playwright" install-deps chromium --dry-run)"; then
  printf '%s\n' "$checked"
  [ "$checked" = "All system dependencies are installed." ]
  exit
fi

mapfile -t lines <<< "$checked"
if [[ ! "${lines[0]}" =~ ^Missing\ system\ dependencies\ \(([1-9][0-9]*)\):$ ]]; then
  printf '%s\n' "$checked" >&2
  exit 1
fi
expected=${BASH_REMATCH[1]}
packages=()
for line in "${lines[@]:1}"; do
  if [[ ! "$line" =~ ^\ \ ([a-z0-9][a-z0-9+.-]*(:[a-z0-9][a-z0-9-]*)?)$ ]]; then
    printf 'Unexpected Playwright package name: %s\n' "$line" >&2
    exit 1
  fi
  packages+=("${BASH_REMATCH[1]}")
done
[ "${#packages[@]}" = "$expected" ] || exit 1
printf '%s\n' "$checked"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash "$script_dir/install-ubuntu-packages.sh" "${packages[@]}"

checked="$("$playwright" install-deps chromium --dry-run)"
printf '%s\n' "$checked"
[ "$checked" = "All system dependencies are installed." ]

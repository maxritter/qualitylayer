#!/usr/bin/env bash
set -euo pipefail

[ "$#" -gt 0 ] || exit 2
packages=("$@")
for package in "${packages[@]}"; do
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*(:[a-z0-9][a-z0-9-]*)?$ ]] || exit 2
done

# Bound network-only downloads before dpkg can touch the package state.
root=()
if (( EUID != 0 )); then root=(sudo); fi
apt=(
  -o Acquire::Retries=0
  -o Acquire::http::Timeout=8
  -o Acquire::https::Timeout=8
  -o Acquire::ForceIPv4=true
)
download() {
  "${root[@]}" timeout --kill-after=5s 90s apt-get "${apt[@]}" "$@" \
    --download-only install -y --no-install-recommends "${packages[@]}"
}
install_cached() {
  "${root[@]}" apt-get "${apt[@]}" "$@" --no-download install -y --no-install-recommends "${packages[@]}"
}
if download; then
  install_cached
else
  # Full release indices and package hashes are still verified by Ubuntu's
  # existing archive keyring when the runner's default mirror is unreachable.
  # shellcheck source=/dev/null
  . /etc/os-release
  [ "$ID" = ubuntu ] && [[ "$VERSION_CODENAME" =~ ^[a-z]+$ ]]
  apt_files="$(mktemp -d)"
  trap 'rm -rf "$apt_files"' EXIT
  chmod 755 "$apt_files"
  cat > "$apt_files/mirrors" <<'MIRRORS'
https://mirrors.edge.kernel.org/ubuntu/	priority:1
https://mirrors.mit.edu/ubuntu/	priority:1
https://mirror.math.princeton.edu/pub/ubuntu/	priority:2
MIRRORS
  for suite in "$VERSION_CODENAME" "$VERSION_CODENAME-updates" "$VERSION_CODENAME-security"; do
    printf 'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:%s %s main universe restricted multiverse\n' \
      "$apt_files/mirrors" "$suite"
  done > "$apt_files/ubuntu.list"
  alternate=(
    -o Dir::Etc::sourcelist="$apt_files/ubuntu.list"
    -o Dir::Etc::sourceparts=-
    -o APT::Get::List-Cleanup=0
  )
  "${root[@]}" timeout --kill-after=5s 75s apt-get "${apt[@]}" "${alternate[@]}" \
    -o Acquire::Languages=none -o APT::Update::Error-Mode=any update
  download "${alternate[@]}"
  install_cached "${alternate[@]}"
fi

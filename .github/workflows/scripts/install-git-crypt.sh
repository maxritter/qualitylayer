#!/bin/bash
# Install git-crypt on a GitHub-hosted Ubuntu runner without depending on the
# Azure-internal Ubuntu mirror.
#
# Why this exists: the hosted amd64 runners resolve deb sources to
# azure.archive.ubuntu.com. When that mirror degrades, `apt-get update` emits
# Ign: lines, falls back to archive.ubuntu.com, and can stall mid-transfer.
# apt applies no transfer timeout by default, so the step hangs until the job
# is killed (2026-08-19: every amd64 release job sat 25+ minutes in this step).
#
# Three defenses, in order:
#   1. Skip entirely when git-crypt is already on PATH.
#   2. Fetch ONLY the universe index (git-crypt's component) from the public
#      mirror, over IPv4, with bounded retries and timeouts. One index file
#      instead of the ~20 a full update pulls, and the broken mirror is never
#      contacted.
#   3. Fall back to a full update with the Azure mirror rewritten away.

set -e

APT_OPTS=(
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=15
  -o Acquire::https::Timeout=15
  -o Acquire::ForceIPv4=true
)

PUBLIC_MIRROR="http://archive.ubuntu.com/ubuntu"
KEYRING="/usr/share/keyrings/ubuntu-archive-keyring.gpg"
TARGETED_LIST="/etc/apt/sources.list.d/qualitylayer-git-crypt.list"

verify() {
  command -v git-crypt >/dev/null 2>&1
}

if verify; then
  echo "git-crypt already installed: $(command -v git-crypt)"
  exit 0
fi

# A macOS runner has Homebrew and no apt.
if [ "$(uname -s)" = Darwin ]; then
  brew install git-crypt
  verify
  exit 0
fi

CODENAME="$(lsb_release -cs 2>/dev/null || echo "")"

# Later browser dependencies use these same sources. Normalize them before the
# targeted install succeeds, so those steps do not return to the slow mirror.
for src in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt; do
  if [ -f "$src" ]; then
    sudo sed -i "s|http://azure.archive.ubuntu.com/ubuntu|$PUBLIC_MIRROR|g" "$src" || true
  fi
done

# Defense 2: universe-only index from the public mirror.
if [ -n "$CODENAME" ] && [ -f "$KEYRING" ]; then
  echo "Fetching universe index for $CODENAME from $PUBLIC_MIRROR"
  echo "deb [signed-by=$KEYRING] $PUBLIC_MIRROR $CODENAME universe" |
    sudo tee "$TARGETED_LIST" >/dev/null
  if sudo apt-get "${APT_OPTS[@]}" \
    -o Dir::Etc::sourcelist="$TARGETED_LIST" \
    -o Dir::Etc::sourceparts=- \
    -o APT::Get::List-Cleanup=0 \
    update &&
    sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends git-crypt; then
    sudo rm -f "$TARGETED_LIST"
    echo "git-crypt installed from the targeted universe index"
    verify
    exit 0
  fi
  echo "Targeted install failed; falling back to a full apt update" >&2
  sudo rm -f "$TARGETED_LIST"
fi

# Defense 3: full update through the already-normalized public mirror.
sudo apt-get "${APT_OPTS[@]}" update
sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends git-crypt

if ! verify; then
  echo "git-crypt installation did not produce a usable binary" >&2
  exit 1
fi

echo "git-crypt installed via the full apt path"

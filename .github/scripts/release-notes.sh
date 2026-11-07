#!/usr/bin/env bash
# GitHub owns the notes; staging keeps a snapshot in the updater manifest.
set -euo pipefail
version="${1:-}"
version="${version#v}"
if [[ $# -ne 1 || ! "$version" =~ ^(1[2-9]|[2-9][0-9]|[1-9][0-9]{2,})\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo 'Usage: .github/scripts/release-notes.sh <version>' >&2
  exit 1
fi
if ! gh release view "v$version" --repo maxritter/qualitylayer --json tagName,body | jq -er --arg tag "v$version" '
  select(.tagName == $tag) | .body | select(type == "string") |
  gsub("(?s)<!--.*?-->"; "") | sub("^\\s+"; "") | sub("\\s+$"; "") | select(length > 0)
'; then
  echo "GitHub release v$version has no usable notes. Write its release draft before staging." >&2
  exit 1
fi

#!/usr/bin/env bash
# After a commit through a private index: bring your own paths in the shared index up to HEAD.
#
#   .github/scripts/refresh-shared-index.sh <path>...
#
# One atomic `git update-index --index-info` for all paths, retried while another git process holds
# index.lock (a status poll, another session's commit), then a check that none of the paths is still
# staged against HEAD. A loop of one `update-index --cacheinfo` per path stops at the first held
# lock and leaves the rest of the paths at their old blobs, staged as reverts (10 November 2026).
# Exits non-zero and names the stale paths when the index could not be brought up to date.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: refresh-shared-index.sh <path>..." >&2
  exit 2
fi

unset GIT_INDEX_FILE
cd "$(git rev-parse --show-toplevel)" || exit 1

zero=$(git hash-object -t blob --stdin </dev/null | tr '0-9a-f' '0')
info=$(mktemp)
err=$(mktemp)
trap 'rm -f "$info" "$err"' EXIT

for path in "$@"; do
  line=$(git ls-tree HEAD -- "$path")
  if [ -n "$line" ]; then
    printf '%s\n' "$line" >>"$info"
  else
    # Gone from HEAD: the entry leaves the index.
    printf '0 %s\t%s\n' "$zero" "$path" >>"$info"
  fi
done

tries=0
until git update-index --index-info <"$info" 2>"$err"; do
  if ! grep -q "index.lock" "$err" || [ "$tries" -ge 120 ]; then
    cat "$err" >&2
    echo "refresh-shared-index: the shared index was not updated" >&2
    exit 1
  fi
  tries=$((tries + 1))
  sleep 0.25
done

stale=$(git --no-optional-locks diff --cached --name-only HEAD -- "$@")
if [ -n "$stale" ]; then
  echo "refresh-shared-index: still staged against HEAD:" >&2
  printf '%s\n' "$stale" >&2
  exit 1
fi

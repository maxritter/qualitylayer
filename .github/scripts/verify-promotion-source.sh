#!/usr/bin/env bash
set -euo pipefail

candidate="${1:?candidate commit required}"
producer="${2:?workflow producer commit required}"
[[ "$candidate" =~ ^[0-9a-f]{40}$ && "$producer" =~ ^[0-9a-f]{40}$ ]]
[ "$(git cat-file -t "$candidate")" = commit ]
[ "$(git cat-file -t "$producer")" = commit ]
git merge-base --is-ancestor "$candidate" "$producer"

changed="$(mktemp)"
trap 'rm -f "$changed"' EXIT
git diff --no-renames --name-only -z "$candidate" "$producer" > "$changed"
while IFS= read -r -d '' path; do
  case "$path" in
    uninstall.sh|qualitylayer/tests/scripts/uninstall-sh.test.ts|qualitylayer/tests/scripts/uninstall-safety.test.ts|.github/workflows/release.yml|.github/scripts/verify-promotion-source.sh|qualitylayer/tests/scripts/test_promotion_source.py) ;;
    *)
      printf 'Promotion refused: candidate runtime or an unreviewed path changed: %s\n' "$path" >&2
      exit 1
      ;;
  esac
  for revision in "$candidate" "$producer"; do
    mode="$(git ls-tree "$revision" -- "$path" | awk '{print $1}')"
    case "$mode" in
      ''|100644|100755) ;;
      *) printf 'Promotion refused: non-regular path: %s\n' "$path" >&2; exit 1 ;;
    esac
  done
done < "$changed"
printf 'Qualified source %s; reviewed publication producer %s\n' "$candidate" "$producer"

#!/usr/bin/env bash
# Plaintext guard for the encrypted trees.
#
# The trees are qualitylayer/ and docs/site/api/, plus the site's backend
# operation scripts and deploy check, the feedback-store worker, scripts/cutover.sh and the film's
# sources in docs/video/ (see
# is_guarded), and every path .gitattributes encrypts. Every tracked path under them must be reported as encrypted by
# `git-crypt status`, except the four manifest files under qualitylayer/ that
# supply-chain scanners need in plaintext. A file that slipped into history
# unencrypted (git-crypt flags it with a NOT ENCRYPTED warning) also fails.
#
# With --range, it instead scans a commit range: every blob a commit of the
# range adds or changes under those paths must begin with git-crypt's header.
# That needs no key and no git-crypt, and it prints paths, never contents.
#
# With --staged, the same check over what the index adds or changes against HEAD
# (GIT_INDEX_FILE is honoured): the pre-commit hook's guard. A path staged
# unchanged was checked when it was committed; `git-crypt status` over the whole
# tree took one to two minutes on every commit.
#
# Run locally as a pre-push check and in CI (works on a locked checkout).
#
# Usage: .github/scripts/check_qualitylayer_encrypted.sh [--range <rev-range> | --staged] [repo-dir]

set -euo pipefail

RANGE=""
STAGED=0
REPO_DIR="."
while [ $# -gt 0 ]; do
  case "$1" in
  --range)
    RANGE="${2:?--range needs a revision range, for example origin/main..HEAD}"
    shift 2
    ;;
  --range=*)
    RANGE="${1#--range=}"
    shift
    ;;
  --staged)
    STAGED=1
    shift
    ;;
  *)
    REPO_DIR="$1"
    shift
    ;;
  esac
done
cd "$REPO_DIR"

# The selective source policy is raw, keyless metadata. It is independent of working attributes.
if [ -f .github/scripts/check_source_policy.py ]; then
  if [ -n "$RANGE" ]; then
    exec python3 .github/scripts/check_source_policy.py --range "$RANGE"
  fi
  if [ "$STAGED" = "1" ] && git cat-file -e :.github/scripts/public-source-policy.json 2>/dev/null; then
    exec python3 .github/scripts/check_source_policy.py --staged
  fi
fi

ALLOWLIST=(
  "qualitylayer/package.json"
  "qualitylayer/bun.lock"
  "qualitylayer/tsconfig.json"
  "qualitylayer/biome.json"
)

is_allowed() {
  local path="$1"
  for allowed in "${ALLOWLIST[@]}"; do
    if [ "$path" = "$allowed" ]; then
      return 0
    fi
  done
  return 1
}

# The guarded paths outside the two trees: the backend operation scripts, the
# deploy check that probes the routes, their tests and the backup recipient, every file of the feedback-store worker,
# the cut-over script, and every tracked file of the film in docs/video/. The website's own build scripts stay plaintext.
is_guarded() {
  case "$1" in
  qualitylayer/* | docs/site/api/*) return 0 ;;
  docs/site/scripts/backup.ts | docs/site/scripts/restore.ts | docs/site/scripts/db-migrate.ts) return 0 ;;
  docs/site/scripts/upload-workflow.ts | docs/site/scripts/load-check.ts) return 0 ;;
  docs/site/scripts/check-deploy.sh | docs/site/scripts/deploy-website.sh | docs/site/scripts/verify-deployment-runtime.mjs) return 0 ;;
  docs/site/scripts/backup-recipient.txt | docs/site/scripts/*.test.ts) return 0 ;;
  docs/site/workers/feedback-store/*) return 0 ;;
  scripts/cutover.sh) return 0 ;;
  docs/video/*) return 0 ;;
  esac
  local pattern
  # Every path .gitattributes encrypts is guarded too, so a new encrypted path needs no edit here.
  # The list above stays: a later "!filter" line can switch encryption off but never the guard.
  for pattern in ${ATTRIBUTE_PATTERNS[@]+"${ATTRIBUTE_PATTERNS[@]}"}; do
    # Unquoted on purpose: a glob. "*" and "**" both match across "/", wider than git, never narrower.
    # shellcheck disable=SC2053
    [[ "$1" == $pattern ]] && return 0
  done
  return 1
}

# The patterns .gitattributes gives `filter=git-crypt`, read once.
ATTRIBUTE_PATTERNS=()
if [ -f .gitattributes ]; then
  while read -r pattern rest || [ -n "$pattern" ]; do
    case "$pattern" in "" | \#*) continue ;; esac
    case " $rest " in *" filter=git-crypt "*) ATTRIBUTE_PATTERNS+=("$pattern") ;; esac
  done <.gitattributes
fi

# Names the guarded paths that sit outside the two trees, so a run shows them.
list_extra() {
  local path
  while IFS= read -r path; do
    case "$path" in
    qualitylayer/* | docs/site/api/*) ;;
    *) echo "  encrypted: $path" ;;
    esac
  done
}


LISTING=""

scan_range() {
  # One raw line per added or changed path in the range.
  git log --format= --raw --no-abbrev --no-renames --diff-filter=AM --root "$RANGE" | scan_raw "$RANGE"
}

scan_staged() {
  local base
  base="$(git rev-parse --verify -q HEAD || git hash-object -t tree /dev/null)"
  git diff --cached --raw --no-abbrev --no-renames --diff-filter=AM "$base" | scan_raw "the staged changes"
}

# Checks the new blob of every guarded path in `git diff --raw` lines on stdin.
scan_raw() {
  local label="$1" failures=0 checked=0 meta blob path
  LISTING="$(mktemp)"
  trap 'rm -f "${LISTING:?}"' EXIT

  # One "<blob> <path>" line per path, once each.
  while IFS=$'\t' read -r meta path; do
    is_guarded "$path" || continue
    if is_allowed "$path"; then
      continue
    fi
    read -r _ _ _ blob _ <<<"$meta"
    printf '%s %s\n' "$blob" "$path"
  done | sort -u >"$LISTING"

  # One `git cat-file --batch` reads every blob; perl names the ones without the header. Four
  # processes per blob took twenty seconds for a few hundred staged files.
  local plain
  plain="$(cut -d' ' -f1 "$LISTING" | git cat-file --batch | perl -e '
    binmode STDIN;
    while (my $line = <STDIN>) {
      my ($sha, $type, $size) = split / /, $line;
      chomp $size;
      read(STDIN, my $body, $size); read(STDIN, my $newline, 1);
      print "$sha\n" if substr($body, 0, 9) ne "\0GITCRYPT";
    }')"
  while IFS=' ' read -r blob path; do
    checked=$((checked + 1))
    case $'\n'"$plain"$'\n' in
    *$'\n'"$blob"$'\n'*)
      echo "PLAINTEXT in $label: $path (blob ${blob:0:10}) is not encrypted" >&2
      failures=$((failures + 1))
      ;;
    esac
  done <"$LISTING"

  if [ "$failures" -gt 0 ]; then
    echo "check_qualitylayer_encrypted: $failures plaintext blob(s) in $label" >&2
    exit 1
  fi
  cut -d' ' -f2- "$LISTING" | list_extra
  echo "check_qualitylayer_encrypted: OK ($checked blob(s) in $label are encrypted)"
}

if [ -n "$RANGE" ]; then
  scan_range
  exit 0
fi
if [ "$STAGED" = "1" ]; then
  scan_staged
  exit 0
fi

if ! command -v git-crypt >/dev/null 2>&1; then
  echo "error: git-crypt is not installed" >&2
  exit 2
fi

failures=0
checked=0
extra_paths=""

# `git-crypt status` prints one line per tracked file:
#   "    encrypted: path" or "not encrypted: path", optionally followed by
#   " *** WARNING: staged/committed version is NOT ENCRYPTED! ***".
while IFS= read -r line; do
  status="${line%%: *}"
  rest="${line#*: }"
  # Strip a trailing git-crypt warning from the path column.
  path="${rest%% \*\*\**}"

  is_guarded "$path" || continue
  if is_allowed "$path"; then
    continue
  fi

  checked=$((checked + 1))

  case "$status" in
  *"not encrypted"*)
    echo "PLAINTEXT: $path is tracked unencrypted" >&2
    failures=$((failures + 1))
    ;;
  *encrypted*)
    if [[ "$line" == *"NOT ENCRYPTED"* ]]; then
      echo "PLAINTEXT IN HISTORY: $path has an unencrypted staged/committed version" >&2
      failures=$((failures + 1))
    else
      extra_paths+="$path"$'\n'
    fi
    ;;
  *)
    echo "UNRECOGNISED git-crypt status line: $line" >&2
    failures=$((failures + 1))
    ;;
  esac
done < <(git-crypt status)

if [ "$failures" -gt 0 ]; then
  echo "check_qualitylayer_encrypted: $failures plaintext path(s) among the guarded paths" >&2
  exit 1
fi

printf '%s' "$extra_paths" | list_extra
echo "check_qualitylayer_encrypted: OK ($checked encrypted path(s), ${#ALLOWLIST[@]} allowlisted)"

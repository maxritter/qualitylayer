#!/bin/bash
# Setup git-crypt for CI/CD builds
# This script decodes the GIT_CRYPT_KEY secret and unlocks the repository

set -e

if [ -z "$GIT_CRYPT_KEY" ]; then
    echo "Error: GIT_CRYPT_KEY environment variable not set"
    exit 1
fi

# Create temporary key file
KEY_FILE=$(mktemp)
trap 'rm -f "$KEY_FILE"' EXIT

# Decode base64 key and write to file
echo "$GIT_CRYPT_KEY" | base64 -d > "$KEY_FILE"

no_process_filter() {
    if git config --get filter.git-crypt.process >/dev/null 2>&1; then
        return 1
    else
        [ "$?" -eq 1 ]
    fi
}

fast_full_checkout() {
    local head native prefix status
    prefix=$(git rev-parse --show-prefix)
    if [ "$(git config --bool core.sparseCheckout)" = "true" ] ||
       [ -n "$prefix" ]; then
        echo "Fast unlock requires a full checkout at its repository root" >&2
        return 1
    fi
    head=$(git rev-parse --verify HEAD)
    if ! no_process_filter; then
        echo "Fast unlock requires no existing alternate git-crypt filter" >&2
        return 1
    fi
    status=$(git status --porcelain)
    if [ "$head" != "${GITHUB_SHA:-$head}" ] || [ -n "$status" ]; then
        echo "Fast unlock requires the expected clean checkout" >&2
        return 1
    fi
    native=$(command -v git-crypt)
    case "$native" in
        /*/git-crypt) ;;
        *) echo "Fast unlock requires installed native git-crypt" >&2; return 1 ;;
    esac
    case "$native" in
        *[!a-zA-Z0-9_./+-]*) echo "Unsafe native git-crypt path" >&2; return 1 ;;
    esac

    # Never leave the temporary filter configured, even when the checkout fails.
    trap 'rm -f "$KEY_FILE"; git config --local --unset-all filter.git-crypt.process >/dev/null 2>&1 || true' EXIT
    if ! bun "$(dirname "$0")/git-crypt-unlock.ts" "$KEY_FILE" >/dev/null 2>&1; then
        echo "Fast checkout unlock failed" >&2
        return 1
    fi
    # Refresh under the fast filter so the first native command does not clean every path again.
    git update-index --refresh
    git config --local filter.git-crypt.clean "\"$native\" clean"
    git config --local filter.git-crypt.smudge "\"$native\" smudge"
    git config --local filter.git-crypt.required true
    git config --local diff.git-crypt.textconv "\"$native\" diff"
    git config --local --unset-all filter.git-crypt.process
    if ! no_process_filter; then
        echo "The alternate git-crypt filter is still configured" >&2
        return 1
    fi
    local unlocked
    unlocked=$(git rev-parse --verify HEAD)
    status=$(git status --porcelain)
    if [ "$unlocked" != "$head" ] || [ -n "$status" ]; then
        echo "The unlocked checkout changed during handoff" >&2
        return 1
    fi
    echo "Repository unlocked with native git-crypt restored"
}

if [ "${1:-}" = "--fast-full-checkout" ]; then
    fast_full_checkout
    exit 0
fi

if [ "$(git config --bool core.sparseCheckout)" != "true" ]; then
    git-crypt unlock "$KEY_FILE"
    echo "Repository unlocked successfully"
    exit 0
fi

# A sparse checkout (a job that needs only part of the tree): git-crypt checks out every
# encrypted file it knows, most of which are not in this checkout, so its own checkout fails once
# the key is in place. The folders this job has are then checked out again through the filter,
# which decrypts only them: on Windows each file costs a process, so this saves minutes.
git-crypt unlock "$KEY_FILE" 2>/dev/null || true
if [ "$(git config --get filter.git-crypt.smudge)" = "" ]; then
    echo "Error: git-crypt could not take the key"
    exit 1
fi
# The encrypted files this checkout has: those not marked skip-worktree ("S") by the sparse checkout.
present=()
while IFS= read -r -d '' entry; do
    [ "${entry:0:1}" = "S" ] || present+=("${entry:2}")
done < <(git ls-files -z -t)
encrypted=()
while IFS= read -r -d '' path; do
    IFS= read -r -d '' _attr
    IFS= read -r -d '' value
    [ "$value" = "git-crypt" ] && encrypted+=("$path")
done < <(printf '%s\0' "${present[@]}" | git check-attr -z --stdin filter)
if [ "${#encrypted[@]}" -gt 0 ]; then
    git checkout -f HEAD -- "${encrypted[@]}"
fi

# Every one must now be plain text: a wrong key leaves git-crypt's header (\0GITCRYPT\0).
header=$(mktemp)
trap 'rm -f "$KEY_FILE" "$header"' EXIT
printf '\0GITCRYPT\0' > "$header"
for path in "${encrypted[@]}"; do
    if cmp -s -n 10 "$header" "$path"; then
        echo "Error: $path is still encrypted"
        exit 1
    fi
done

echo "Repository unlocked successfully: ${#encrypted[@]} encrypted files in the sparse checkout"

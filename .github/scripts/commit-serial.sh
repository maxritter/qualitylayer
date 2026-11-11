#!/usr/bin/env bash
# Run `git commit` one at a time in this checkout: a drop-in for `git commit <args>`.
#
#   .github/scripts/commit-serial.sh -F <message-file> [other git commit args]
#
# `git commit -F` first copies the message into the single shared .git/COMMIT_EDITMSG and reads it
# back after the hooks, so two overlapping commits (each with its own GIT_INDEX_FILE) can swap
# messages (11 November 2026). This takes a lock around the whole commit. No flock on macOS, so the
# lock is an atomic `mkdir` under the git dir whose `owner` file holds "<pid> <start epoch>".
# A lock is stale when its owner pid is dead or it is older than 10 minutes; it is then taken over.
# Hooks always run (no --no-verify). GIT_INDEX_FILE and every argument pass through to git.
# After the commit, HEAD's message must equal the -F file; if not, and HEAD is still the new
# commit, only the message is amended (inside the lock).
set -u

max_age=600    # seconds before a lock counts as stale
max_wait=300   # seconds to wait for the lock

lock="$(cd "$(git rev-parse --git-common-dir)" && pwd)/commit-serial.lock"
mypid=$$

# Read the owner of the current lock: sets owner_pid and owner_start ("" when not written yet).
read_owner() {
  owner_pid="" owner_start=""
  read -r owner_pid owner_start <"$lock/owner" 2>/dev/null || true
  if [ -z "$owner_start" ]; then
    # mkdir done, owner file not written yet (or unreadable): age by the directory's mtime.
    owner_start=$(stat -f %m "$lock" 2>/dev/null || date +%s)
  fi
}

# Is the lock we just read stale?
is_stale() {
  [ $(($(date +%s) - owner_start)) -gt "$max_age" ] && return 0
  [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null && return 0
  return 1
}

release() {
  # Only remove a lock that is still ours.
  read_owner
  [ "$owner_pid" = "$mypid" ] && rm -rf "$lock"
}

acquire() {
  local began delay=0.2 trash
  began=$(date +%s)
  until mkdir "$lock" 2>/dev/null; do
    read_owner
    if is_stale; then
      echo "commit-serial: taking over stale lock (pid ${owner_pid:-?}, started $(date -r "$owner_start" +%T))" >&2
      # mv is atomic: of several sessions taking over, one wins. Check we moved the stale lock
      # and not a fresh one that appeared in between; if so, put it back.
      trash="$lock.stale.$mypid"
      if mv "$lock" "$trash" 2>/dev/null; then
        read -r p _ <"$trash/owner" 2>/dev/null
        if [ "${p:-}" != "$owner_pid" ] && [ -n "$owner_pid" ]; then
          [ -e "$lock" ] || mv "$trash" "$lock" 2>/dev/null
        fi
        rm -rf "$trash"
      fi
      continue
    fi
    if [ $(($(date +%s) - began)) -ge "$max_wait" ]; then
      echo "commit-serial: gave up after ${max_wait}s; lock held by pid ${owner_pid:-?}" >&2
      exit 1
    fi
    echo "commit-serial: waiting for pid ${owner_pid:-?} (running $(($(date +%s) - owner_start))s)" >&2
    sleep "$delay"
    # Backoff: 0.2s growing to 2s.
    case "$delay" in 0.2) delay=0.5 ;; 0.5) delay=1 ;; 1) delay=2 ;; esac
  done
  printf '%s %s\n' "$mypid" "$(date +%s)" >"$lock/owner"
}

head_before=$(git rev-parse -q --verify HEAD || echo none)
acquire
trap release EXIT
# A private index prepared before the wait is based on the old HEAD; the commit would revert
# whatever landed meanwhile. Not blocked (the agent decides), but said out loud.
if [ "$(git rev-parse -q --verify HEAD || echo none)" != "$head_before" ]; then
  echo "commit-serial: WARNING HEAD moved while waiting; check the private index is based on it" >&2
fi
trap 'exit 130' INT
trap 'exit 143' TERM

# The message file given with -F / --file, if any.
msgfile=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    -F | --file) msgfile="${args[i + 1]:-}" ;;
    --file=*) msgfile="${args[i]#--file=}" ;;
    -F?*) msgfile="${args[i]#-F}" ;;
  esac
done

git commit "$@"
status=$?
[ "$status" -eq 0 ] || exit "$status"
[ -n "$msgfile" ] && [ -f "$msgfile" ] || exit 0

# Did HEAD get the intended message? (git strips trailing blanks; stripspace does the same.)
new=$(git rev-parse HEAD)
want=$(git stripspace <"$msgfile")
got=$(git log -1 --format=%B "$new")
if [ "$want" != "$got" ]; then
  echo "commit-serial: HEAD $new has the wrong message; amending the message only" >&2
  if [ "$(git rev-parse HEAD)" = "$new" ]; then
    git commit --amend --no-edit -F "$msgfile" || exit $?
  else
    echo "commit-serial: HEAD moved; not amending. Fix the message by hand." >&2
    exit 1
  fi
fi

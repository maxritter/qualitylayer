#!/usr/bin/env bash
# Run `git commit` one at a time in this checkout: a drop-in for `git commit <args>`.
#
#   .github/scripts/commit-serial.sh -F <message-file> [other git commit args]
#
# `git commit -F` first copies the message into the single shared .git/COMMIT_EDITMSG and reads it
# back after the hooks, so two overlapping commits (each with its own GIT_INDEX_FILE) can swap
# messages (11 November 2026). This holds one lock around the whole commit:
#   1. `flock`, if installed (Linux);  2. Python's fcntl.flock via `/usr/bin/python3 -I` (macOS);
#   3. otherwise an atomic `mkdir` lock whose `owner` file holds "<pid> <start epoch>".
# The advisory locks (1, 2) are released by the OS when the process dies, so they never go stale.
# The mkdir lock is taken over only when its owner pid is dead; a live owner is waited for, however
# old (we cannot tell a slow commit from a safe one). Waits up to 5 minutes, printing the holder.
# Hooks always run (no --no-verify). GIT_INDEX_FILE and every argument pass through to git.
# HEAD is recorded before waiting: with a private index, a HEAD that moved meanwhile makes the index
# stale, so the commit is refused. After the commit, HEAD's message must equal the -F file; if not
# (another writer's commit got there), a receipt is written and the exit is non-zero. No amend.
set -u

max_wait=300 # seconds to wait for the lock
gitdir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
flockfile="$gitdir/commit-serial.flock" # advisory lock file; holds "<pid> <start epoch>"
lockdir="$gitdir/commit-serial.lock"    # mkdir fallback

# Stage 1 (not yet locked): remember HEAD, then re-enter under the Python lock if that is the choice.
if [ -z "${COMMIT_SERIAL_HEAD_BEFORE:-}" ]; then
  export COMMIT_SERIAL_HEAD_BEFORE
  COMMIT_SERIAL_HEAD_BEFORE=$(git rev-parse -q --verify HEAD || echo none)
  if ! command -v flock >/dev/null 2>&1 && /usr/bin/python3 -I -c pass 2>/dev/null; then
    exec /usr/bin/python3 -I -c '
import fcntl, os, sys, time
path, wait, argv = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
end, n = time.time() + wait, 0
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except OSError:
        if time.time() >= end:
            sys.exit("commit-serial: gave up after %ds waiting for the lock" % wait)
        if n % 10 == 0:  # every ~2s
            holder = os.pread(fd, 100, 0).decode().strip()
            print("commit-serial: waiting for lock held by (pid, start) %s" % (holder or "?"), file=sys.stderr)
        n += 1
        time.sleep(0.2)
os.set_inheritable(fd, True)  # the lock lives as long as this open file stays open in the commit
os.execv(argv[0], argv)
' "$flockfile" "$max_wait" "$BASH" "$0" "$@"
  fi
  held=""
else
  held=1 # re-entered by the Python locker above: the lock is already ours
fi

now() { date +%s; }
mypid=$$

if [ -z "$held" ]; then
  if command -v flock >/dev/null 2>&1; then
    exec 9>>"$flockfile"
    waited=0
    until flock -n 9; do
      [ "$waited" -ge "$max_wait" ] && { echo "commit-serial: gave up after ${max_wait}s" >&2; exit 1; }
      echo "commit-serial: waiting for lock held by (pid, start) $(cat "$flockfile" 2>/dev/null)" >&2
      sleep 2
      waited=$((waited + 2))
    done
  else
    # mkdir fallback: take over only a lock whose owner pid is dead.
    began=$(now)
    until mkdir "$lockdir" 2>/dev/null; do
      read -r opid ostart <"$lockdir/owner" 2>/dev/null || true
      age=$(($(now) - ${ostart:-$(stat -f %m "$lockdir" 2>/dev/null || now)}))
      # No owner file after 60s: its creator died between mkdir and writing it.
      if { [ -n "${opid:-}" ] && ! kill -0 "$opid" 2>/dev/null; } || { [ -z "${opid:-}" ] && [ "$age" -gt 60 ]; }; then
        echo "commit-serial: taking over lock of dead pid ${opid:-?}" >&2
        trash="$lockdir.dead.$mypid"
        # mv is atomic, so one taker wins; put it back if we moved a fresh lock by mistake.
        if mv "$lockdir" "$trash" 2>/dev/null; then
          read -r p _ <"$trash/owner" 2>/dev/null
          [ "${p:-}" = "${opid:-}" ] || { [ -e "$lockdir" ] || mv "$trash" "$lockdir" 2>/dev/null; }
          rm -rf "$trash"
        fi
        continue
      fi
      [ $(($(now) - began)) -ge "$max_wait" ] && { echo "commit-serial: gave up after ${max_wait}s" >&2; exit 1; }
      echo "commit-serial: waiting for live pid ${opid:-?} (held ${age}s; a live owner is never taken over)" >&2
      sleep 2
    done
    release() { read -r p _ <"$lockdir/owner" 2>/dev/null; [ "${p:-}" = "$mypid" ] && rm -rf "$lockdir"; }
    trap release EXIT
  fi
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

# Locked. Record ourselves as the holder (for the others' "waiting" notes).
if [ -n "$held" ] || command -v flock >/dev/null 2>&1; then
  printf '%s %s\n' "$mypid" "$(now)" >"$flockfile"
else
  printf '%s %s\n' "$mypid" "$(now)" >"$lockdir/owner"
fi

# A private index prepared before the wait is based on the old HEAD: committing it would revert what
# landed meanwhile. Refuse; the agent rebuilds the index on the new HEAD and retries.
head_now=$(git rev-parse -q --verify HEAD || echo none)
if [ -n "${GIT_INDEX_FILE:-}" ] && [ "$head_now" != "$COMMIT_SERIAL_HEAD_BEFORE" ]; then
  echo "commit-serial: HEAD moved from $COMMIT_SERIAL_HEAD_BEFORE to $head_now; rebuild your private index on the new HEAD (docs/agents/operations.md) and retry." >&2
  exit 1
fi

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
head=$(git rev-parse HEAD)
want=$(git stripspace <"$msgfile")
got=$(git log -1 --format=%B "$head")
if [ "$want" != "$got" ]; then
  # HEAD may be another writer's commit: change no history, leave a receipt.
  receipt="$gitdir/commit-serial-mismatch-$(now).txt"
  {
    echo "commit-serial: HEAD does not carry the intended message; nothing was amended."
    echo "HEAD:    $head"
    echo "subject: $(git log -1 --format=%s "$head")"
    echo "files in HEAD:"
    git show --name-only --format= "$head" | sed 's/^/  /'
    echo "expected message ($msgfile):"
    printf '%s\n' "$want" | sed 's/^/  /'
  } 2>&1 | tee "$receipt" >&2
  echo "receipt: $receipt" >&2
  exit 1
fi

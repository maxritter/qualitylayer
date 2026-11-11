#!/usr/bin/env bash
# Run `git commit` one at a time in this checkout: a drop-in for `git commit <args>`.
#
#   .github/scripts/commit-serial.sh -F <message-file> [other git commit args]
#
# `git commit -F` first copies the message into the single shared .git/COMMIT_EDITMSG and reads it
# back after the hooks, so two overlapping commits (each with its own GIT_INDEX_FILE) can swap
# messages (11 November 2026). This holds one OS advisory lock around the whole commit: `flock` if
# installed (Linux), else Python's fcntl.flock via `/usr/bin/python3 -I` (macOS). The OS frees the
# lock when the holder dies, so it never goes stale. No third fallback: an mkdir lock cannot be
# taken over safely, so without either tool the script refuses. The lock is on fd 9, which the
# commit's hooks do not inherit (a hook's leftover background process cannot keep it).
# Waits up to 5 minutes, printing the holder. Hooks always run (no --no-verify); GIT_INDEX_FILE and
# every argument pass through to git.
# Exit codes: 75 = lock timeout, or HEAD moved while waiting (with a private index: rebuild it on
# the new HEAD and retry); 3 = the commit landed but HEAD does not carry the -F message (another
# writer's commit; receipt written, nothing amended); otherwise git's own code.
set -u

max_wait=300 # seconds to wait for the lock
gitdir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
lockfile="$gitdir/commit-serial.flock" # holds "<pid> <start epoch>" of the holder
now() { date +%s; }
mypid=$$

# Stage 1, not yet locked: remember HEAD, then lock (flock here, Python by re-exec).
# COMMIT_SERIAL_LOCKED="<pid>:<gitdir>" says the Python locker already took the lock for this very
# process; a copy inherited from elsewhere has another pid or gitdir and is ignored.
if [ "${COMMIT_SERIAL_LOCKED:-}" != "$mypid:$gitdir" ]; then
  export COMMIT_SERIAL_HEAD_BEFORE
  COMMIT_SERIAL_HEAD_BEFORE=$(git rev-parse -q --verify HEAD || echo none)
  if command -v flock >/dev/null 2>&1; then
    exec 9>>"$lockfile"
    waited=0
    until flock -n 9; do
      if [ "$waited" -ge "$max_wait" ]; then
        echo "commit-serial: gave up after ${max_wait}s" >&2
        exit 75
      fi
      echo "commit-serial: waiting for lock held by (pid, start) $(cat "$lockfile" 2>/dev/null)" >&2
      sleep 2
      waited=$((waited + 2))
    done
  elif /usr/bin/python3 -I -c pass 2>/dev/null; then
    # exec keeps the pid and the lock fd (dup'd to 9); bash continues as stage 2.
    export COMMIT_SERIAL_LOCKED="$mypid:$gitdir"
    exec /usr/bin/python3 -I -c '
import fcntl, os, sys, time
path, wait, argv = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
end, n = time.time() + wait, 0
try:
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            if time.time() >= end:
                print("commit-serial: gave up after %ds" % wait, file=sys.stderr)
                sys.exit(75)
            if n % 10 == 0:  # about every 2s
                holder = os.pread(fd, 100, 0).decode().strip()
                print("commit-serial: waiting for lock held by (pid, start) %s" % (holder or "?"), file=sys.stderr)
            n += 1
            time.sleep(0.2)
except KeyboardInterrupt:
    sys.exit(130)
os.dup2(fd, 9)
os.set_inheritable(9, True)
if fd != 9:
    os.close(fd)
os.execv(argv[0], argv)
' "$lockfile" "$max_wait" "$BASH" "$0" "$@"
  else
    echo "commit-serial: need flock or /usr/bin/python3; cannot lock safely, refusing." >&2
    exit 75
  fi
fi
unset COMMIT_SERIAL_LOCKED

trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s %s\n' "$mypid" "$(now)" >"$lockfile"

# A private index prepared before the wait is based on the old HEAD: committing it would revert what
# landed meanwhile. Refuse; the agent rebuilds the index on the new HEAD and retries.
head_pre=$(git rev-parse -q --verify HEAD || echo none)
if [ -n "${GIT_INDEX_FILE:-}" ] && [ "$head_pre" != "$COMMIT_SERIAL_HEAD_BEFORE" ]; then
  echo "commit-serial: HEAD moved from $COMMIT_SERIAL_HEAD_BEFORE to $head_pre; rebuild your private index on the new HEAD (docs/agents/operations.md) and retry." >&2
  exit 75
fi
unset COMMIT_SERIAL_HEAD_BEFORE

# The message file from -F / --file, if any; options that make the check meaningless skip it.
msgfile="" skip=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    --) break ;;
    -F | --file) msgfile="${args[i + 1]:-}" ;;
    --file=*) msgfile="${args[i]#--file=}" ;;
    -F?*) msgfile="${args[i]#-F}" ;;
    --dry-run | --amend) skip=1 ;;
  esac
done

git commit "$@" 9>&-
status=$?
[ "$status" -eq 0 ] || exit "$status"
[ -z "$skip" ] && [ -n "$msgfile" ] && [ "$msgfile" != "-" ] && [ -f "$msgfile" ] || exit 0

# Find our commit: the one whose parent is the HEAD we committed on (another writer may have moved
# HEAD since). It must start with the intended message (git or hooks may add trailers).
want=$(git stripspace <"$msgfile")
ours=""
for c in $(git rev-list -n 10 HEAD); do
  [ "$(git rev-parse -q --verify "$c^" || echo none)" = "$head_pre" ] && { ours=$c; break; }
done
got=""
[ -n "$ours" ] && got=$(git log -1 --format=%B "$ours")
case "$got" in "$want"*) [ -n "$ours" ] && exit 0 ;; esac

# HEAD may be another writer's commit: change no history, leave a receipt.
head=$(git rev-parse HEAD)
receipt="$gitdir/commit-serial-mismatch-$(now)-$mypid.txt"
{
  echo "commit-serial: HEAD does not carry the intended message; nothing was amended."
  echo "HEAD:    $head"
  echo "subject: $(git log -1 --format=%s "$head")"
  echo "files in HEAD:"
  git show --name-only --format= "$head" | sed 's/^/  /'
  echo "expected message ($msgfile):"
  printf '%s\n' "$want" | sed 's/^/  /'
  echo "receipt: $receipt"
} 2>&1 | tee "$receipt" >&2
exit 3

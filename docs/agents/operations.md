# QualityLayer agent reference

## Repository rules

- Preserve unrelated work in the dirty worktree. Do not reset, restore, or
  overwrite concurrent changes.
- Several sessions can share one worktree, and its index too. Commit by hand
  through a private index, the way `qualitylayer commit slice` does: set
  `GIT_INDEX_FILE` to a temporary file, copy `.git/index` to it and run
  `git read-tree --reset HEAD` (the copy keeps the stat cache; a bare
  `git read-tree HEAD` makes git re-filter every file through git-crypt and
  the commit takes minutes instead of seconds), add only your
  files (`git update-index` or `hash-object --path`, which runs the git-crypt
  filter), then commit with `.github/scripts/commit-serial.sh -F <message-file>`
  (same arguments as `git commit`; it runs commits one at a time because
  `git commit -F` goes through the shared `.git/COMMIT_EDITMSG`, so overlapping
  commits swapped messages). It refuses a private index when HEAD moved while
  it waited (rebuild the index on the new HEAD and retry) and, if HEAD does not
  carry your message, exits non-zero with a receipt in `.git/` instead of
  amending. Afterwards bring your own paths in the shared index up
  to the new commit with `.github/scripts/refresh-shared-index.sh <paths>`;
  otherwise it keeps their old blobs and the next commit from it reverts
  yours. The script sets all paths in one `git update-index --index-info`
  call, waits while another git process holds `index.lock` (a status poll,
  another session's commit) and fails by name if a path is still staged. A
  loop of one `update-index --cacheinfo` per path stops at the first held
  lock and leaves the rest stale, and a hidden error then looks like
  something overwrote the index (10 November 2026). Never discard that
  command's exit code or stderr. Do not use `git reset -q HEAD -- <paths>` on
  the shared index: it holds the lock through a full git-crypt refresh, so
  other sessions' updates fail meanwhile. Never commit from the shared index.
  Never stage, unstage or reset paths in the shared index that are not yours.
  Two commits at the same moment share `.git/COMMIT_EDITMSG`, and the later
  message can land on both: after every commit, check that
  `git show --stat --format=%s HEAD` shows your files under your message.
  After a failed hook, reuse the prepared private index when its base HEAD and
  reviewed scope still match. Stage only the repaired owned paths, verify the
  rest still matches the reviewed content, and run the normal hooks again.
- To check a prepared commit message before the slower hooks, optionally run
  `.github/hooks/commit-msg <message-file>` with the same private index, then
  commit with `.github/scripts/commit-serial.sh -F <message-file>`. Keep the final normal hook: a
  changed message or index needs its current validation, not a cached pass.
- Never move source, phase texts, schemas or fixtures out of `qualitylayer/`.
- Read committed encrypted paths with `git cat-file --filters HEAD:<path>`.
  `git show HEAD:<path>` returns git-crypt ciphertext and cannot be linted as source.
- Before pushing from a private copy, fetch the actual remote's main and target
  branch into its remote-tracking refs. The pre-push encryption guard uses those
  refs to identify unpublished commits; missing refs make it scan inherited
  history. Keep the hook active and verify the intended remote SHA before push.
- Review encrypted working changes with `git diff --textconv -- <path>` (or
  `git diff --cached --textconv -- <path>` for an index). The configured
  `diff.git-crypt.textconv` decrypts the patch for review; `--stat` and
  `--numstat` can still report binary sizes. Do not replace the encrypted
  Git blobs with plaintext to make those counts readable. A helper reviewing
  another commit can use `git show --textconv <commit> -- <path>`.
- A linked worktree needs the existing git-crypt keys before checkout. Create
  it with `git worktree add --no-checkout`; resolve its private Git directory
  and the common Git directory with `git rev-parse`. Symlink the private Git
  directory's `git-crypt` to the common Git directory's `git-crypt`, then
  populate the still-empty worktree with `git read-tree -mu HEAD`. Keep keys
  and that symlink in Git metadata; reuse the existing keys.
- Use the agent's native file tools for source edits. No bundled tooling (RTK,
  Semble, CodeGraph) is required or assumed.
- Tests never touch the real `HOME` or the network: they run the built binary
  against a temp git repository and a temp `HOME`, with Polar, the trial
  service and releases pointed at local fixtures or a closed port.
- Never run `install.sh`, `qualitylayer install`, the v11 upgrade or any
  uninstaller against the real `HOME` of a development machine; use a temp
  `HOME`.
- Never switch branches, commit, push, rebase, or force-update history
  without the corresponding user authorization.
- Resource budget: any change to the server, its polls, watchers, hooks or
  background CLI paths keeps `tests/e2e/resource-budget.test.ts` green. Git and
  `gh` calls are cached on what changes their answer, children are reaped, and
  idle is near 0% CPU. Files that grow in the QualityLayer home carry a cap
  (`core/home-caps.ts`); the server's own check is `server/resource-guard.ts`.
- Detached native sessions have a 15-minute idle deadline after a verified
  completed turn and viewer detachment. Active turns, pending human decisions,
  helpers and missing resume files retain the session. Keep the critical smoke
  checks `tests/core/run-idle.test.ts` and `tests/e2e/agent-host-idle.test.ts`
  green; they cover safe boundaries, concurrent gate changes and owned process
  cleanup without deleting the native transcript. Peer shims for those sessions
  exit through their existing native-holder liveness check after cleanup.


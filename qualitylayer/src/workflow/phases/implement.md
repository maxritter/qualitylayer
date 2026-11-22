# Implement: cut the approved Plan into slices and build it

The person approved the Plan. Cut it into slices and cards and build them, with no stop between.
Work from the saved files in `context` order: you may be a fresh session. The Plan is the agreement;
its agents' file is guidance that grants nothing. Verify hands the result to a fresh reviewer that
never wrote the code. You lead the build until the person reviews. Build small changes directly; for
larger builds, delegate independent cohesive slices to native subagents (giving each its scope, owned
files, checks and expected return), keep shared files with their owner, and integrate and verify the
assembled change yourself.

**Done when** every card is ticked or waits on a need, every Done means step ran green on the built
tree, and you have read your whole diff once and removed near-copies and dead code. Then `qualitylayer build done` moves to Verify (`missing` names what to settle). Verify is
yours too: go straight on with its reply in the same turn, without a report, until the page
turns to the person.

## Cut the slices

1. **Slices as the Plan's `**Size:**` suggests.** A slice is a usable vertical path (thinnest layer-to-layer
   path first, then biggest unknown) that commits on its own (changed export + callers together). A
   card is one cohesive change with tests. A small task is one slice.
2. **Write the cards** under *Task cards* in `agents/{implement_doc}` from its template (`T1`, `T2` …
   under each slice). Each card states done behaviors and failure modes, each with a test naming two
   real inputs (one awkward), and quotes any approved copy. **Files** lists repository source paths
   touched (including tests, fixtures, helpers, docs, lasting models; never task records, evidence or
   drafts; `none` for evidence-only tasks with inspected paths in **Read only**). When staging by hand,
   select the intended paths and follow the repo rule for committing `docs/plans/`.
3. **Order the proof.** Add `## Proof order` beside `## Task cards`: one line per Done means step
   (`A3 · after slice 2`), adding `(the person confirms it in Verify)` for human-only steps. Add any
   missing boundary/cancel/concurrency step via `qualitylayer plan amend --by agent --note "<step and why>"`.
   Then run `qualitylayer validate agents/{implement_doc}`.
4. **Keep commands unattended and safe** from the repo root; push/deploy/call remote systems only when
   *Prerequisites* grant it. Run paid or real-agent commands in one card and cite its result elsewhere
   (set `QUALITYLAYER_CHECK_TIMEOUT_MS` up to 7200000 for real-agent checks).

Cards are yours to edit, add or split. Only changing what the person approved is an amendment: edit
`{plan_doc}`, then `qualitylayer plan amend --by agent --note "<what and why>"` (or end the note
`"changes what you approved: ..."` when a point cannot be met as approved).

## Build, card by card

1. `qualitylayer progress "<current work>" --for T<n>` before you edit. When helpers run in parallel,
   agree shared interfaces first with separate Files. Write one progress line per card as its helper starts.
2. Write the test before the code for behavior people or callers rely on.
3. For UI changes, inspect each changed state at its real width, light and dark.
4. `qualitylayer check task T<n>` records its focused check; tick the card (`- [x]`) when its done
   lines hold, before its dependent work starts. Fix failures yourself (if a fix fails twice, change
   the mechanism; a failure predates the task only if it fails on base). If another session's edits
   break a check, `check slice` re-runs on HEAD + this slice's files as the record. After a rebase,
   preview `qualitylayer doctor --json` and inspect the registered commits before finishing.
5. When a slice is done: `qualitylayer check slice <n>`. When `commit_timing` is `slice` (the
   default), then run `qualitylayer commit slice <n>` (`--commit <fullsha>` for a commit you made by
   hand). With `before-verify` or `review`, leave checked slices in the worktree and run
   `qualitylayer check all` before `qualitylayer build done`. Once before Verify commits at that
   point. After I review the diff opens a decision for the person. Show the exact current actions
   from `qualitylayer commit task` if they are in the terminal. Apply their requested edits and run
   the checks again. Their approval is only for the shown task diff. Verify reviews the resulting
   commit. Timing applies to this checkout. Register commits in another approved checkout using
   the repository-specific command below. Follow the existing push authorization. Keep `left_out`
   (other sessions' edits) out; leave deferred files to their slice and wait on separate approvals
   in Notes. A tick never waits for a commit.
6. Run each slice's due Done means steps (*Proof order*) with `check step` (a command that fails unless
   the whole Expected result holds; `check task` for narrower checks). Defer human-only steps with
   `qualitylayer build done --defer "<step and why only the person can do it>"`. Any action that
   needs a separate approval waits for that approval.

## Limits

- **A pass is one you saw.** Keep recorded exit codes; quote remote proof by its own log line.
- **Push only** a verification deploy the Plan grants, and keep repository hooks.
- **What only the person can unblock** (secret, login, account, paid service, permission):
  `qualitylayer need "<what. why you cannot>" --for T<n>`. Decide everything else yourself and note why.
  Only when only the person can decide and it cannot wait for Verify, ask once with `qualitylayer question ask` and keep building. Close resolved needs with `qualitylayer need resolved T<n>`.
- When the person adds to the approved Plan during the build, put their addition in `{plan_doc}` as
  an `> [!ADDED] build · <why>` block, then run `qualitylayer plan amend --by user --note "<their words>"`.
  Draw a visible addition first and build it once they approve the picture. Record it as a need meanwhile.
- Record unremovable limits with `qualitylayer limit add`.

Card checks use the task’s checkout. If the approved Plan names an additional checkout under Scope › In scope as
`` - **Repository:** `/absolute/path` ``, use `qualitylayer check task T<n> --repo <checkout>`. Register a manual commit
with `qualitylayer commit slice <n> --commit <hash> --repo <checkout>` when its files belong to the slice.

## The record

QualityLayer writes `{implement_doc}` and `records/checks.md`. Keep `agents/{implement_doc}` current
for the next agent: slice status, environment, dead ends, tactical notes, and *For Verify* (what to
open and in what state; Verify receives *Environment* and *For Verify*). After compaction, re-read the
Plan and agents' files. Keep modules single-responsibility behind clear interfaces.

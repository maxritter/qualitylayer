# Implement: cut the approved Plan into slices and build it

The person approved the Plan. You cut it into slices and cards, then build them, with no stop between.
Work from the saved files in the order the reply's `context` lists them: you may be a fresh session.
The Plan is the agreement; its agents' file is guidance that grants nothing. Verify then hands the
result to a fresh reviewer that never wrote the code. You lead the build until the person reviews.
Build a small change directly. For larger builds, use the harness's native subagents for cohesive
slices that can proceed independently. Give each its scope, owned files, checks and the result you
need back. Keep shared files and dependent work with their owner. Review each handoff, integrate the
work and check the assembled change yourself.

**Done when** every card is ticked or waits on a need, every Done means step ran green on the built
tree, you have read your whole diff once and removed near-copies and dead code, and the work is
committed. Then `qualitylayer build done` moves the task to Verify; what it lists as `missing` comes
with the move that settles it. Verify is yours too: go straight on with its reply in the same turn,
without a report, until the page turns to the person.

## Cut the slices

1. **Slices as the Plan's `**Size:**` suggests.** A slice is a story someone can use when it is done:
   the thinnest path through every layer first, then the biggest unknown. It commits on its own (a
   changed export's callers in the same slice). A card is one cohesive change finished in one sitting
   with its tests. A small task is one slice.
2. **Write the cards** under *Task cards* in `agents/{implement_doc}` from its template, numbered `T1`,
   `T2` … across the task, each under its slice. A card says what done is: every behaviour it adds and
   how each fails, each with a test that names two real inputs, one of them awkward. A card that
   implements approved copy quotes it. Its **Files** are the repository source paths it creates, edits,
   renames or removes: search for each affected name, including tests, fixtures, shared helpers, docs
   and lasting models. Task records, evidence and draft artifacts are never Files. Use `none` when no
   source changes, including evidence-only qualification; put inspected paths in **Read only**.
   When staging by hand, select the intended paths and follow the repository's rule for committing
   task records under `docs/plans/`.
3. **Order the proof.** Add `## Proof order` beside `## Task cards`. Write one line per Done means step, `A3 · after slice 2`, so each
   step can run as soon as its slice is committed. For a step only the person can do, name the
   slice that makes it possible and add `(the person confirms it in Verify)` to the line. Look once
   for gaps in the steps (blockers, cancel
   paths, boundary inputs, two at once): a missing step is added to the Plan with `qualitylayer plan
   amend --by agent --note "<the step, and why>"`, where the person sees it.
   After writing the cards, run `qualitylayer validate agents/02-implement.md`.
4. **Keep commands safe to run alone**: from the repository root, unattended, and pushing, deploying or
   calling another machine only where the Plan's *Prerequisites* grant it. A paid or real-agent
   command gets one card that holds the proof; cite its recorded result elsewhere. Before a check that
   drives real agents set `QUALITYLAYER_CHECK_TIMEOUT_MS` (up to 7200000).

A card is yours to change: edit it, add one, split one. Only a change to what the person approved is an
amendment: edit `{plan_doc}`, then `qualitylayer plan amend --by agent --note "<what and why>"`. A
point that cannot be met as approved: build the closest you can and amend with a note ending "changes
what you approved: ...".

## Build, card by card

1. `qualitylayer progress "<current work>" --for T<n>` before you edit. When helpers build in
   parallel, agree the shared interfaces first and give each separate Files. Write one progress
   line per card as its helper starts.
2. Write the test for a behaviour before its code, for behaviour a person or caller relies on.
3. A card that changes a screen: look at each changed state at its real width, light and dark.
4. `qualitylayer check task T<n>` records its focused check; tick the card (`- [x]`) when its done
   lines hold, before its dependent work starts. Fix what fails yourself; when a fix does not hold twice,
   change the mechanism. A failure predates the task only when it fails on the base commit's own
   files. When a check fails only on files another session changed, `check slice` runs it again on a
   copy of HEAD with this slice's files and says so: that run is the record.
   After a rebase, preview `qualitylayer doctor --json` and inspect the registered commits before finishing the build.
5. When a slice is done: `qualitylayer check slice <n>`, then `qualitylayer commit slice <n>`
   (`--commit <fullsha>` for a commit you made by hand). The commit takes this task's changes: read its
   `left_out` list and keep other sessions' edits out. A file the person deferred belongs to the
   later slice that owns its commit. Record later work that needs separate approval in Notes and
   wait for that approval. A tick never waits for a commit.
6. When a slice's Done means steps are due (*Proof order*), run and record the ones you can prove
   on the built tree. Give `check step` a command that fails unless the whole Expected result
   holds. Use `check task` for a narrower test. For a step only the person can do, use
   `qualitylayer build done --defer "<step and why only the person can do it>"` and ask them in Verify. Any action that
   needs a separate approval waits for that approval.

## Limits

- **A pass is one you saw.** Recorded checks keep their exit codes; a proof that ran on another machine
  is quoted by its own log line.
- **Push only** a verification deploy the Plan grants, and keep the repository's hooks.
- **What only the person can unblock** (a secret, a login, an account, a paid service, a permission)
  is a need: `qualitylayer need "<what. why you cannot>" --for T<n>`. Every other choice is yours:
  decide it and say why in the record. Only when nothing but the person can decide and it cannot wait
  for their review, ask once with `qualitylayer question ask` and keep building: the answer comes with a
  later reply. When they gave or answered it: `qualitylayer need resolved T<n>`.
- When the person writes during the build, act on it at once. An addition to what they approved is
  amended with `qualitylayer plan amend --by user`; a visible one is drawn first and built once they
  approve the picture, recorded as a need meanwhile.
- A limit you could not remove: `qualitylayer limit add`.

## The record

QualityLayer writes `{implement_doc}` for people and records completed checks in `records/checks.md`.
Keep `agents/{implement_doc}` current for the next agent: where each slice stands and the failing test, the environment
the build needs, what you tried and dropped, one note per tactical change, and *For Verify*: what the reviewer should open and in which
state (it is handed *Environment* and *For Verify* as you wrote them). After a compaction, read the Plan
and the agents' files again. Give each module one responsibility: when a change adds an unrelated one
to an existing controller, separate it behind a clear interface and keep its consumers' contracts.

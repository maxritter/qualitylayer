# Implement: cut the approved Plan into slices and build it

Cut the approved Plan into slices and cards and build them without stopping. Work from the saved files in `context` order; the Plan is the agreement and its agents' file grants nothing. You lead the build until the person reviews. Build small changes directly; for larger builds, delegate independent cohesive slices to native subagents (explicit scope, owned files, checks), keep shared files with one owner, and integrate and verify the result yourself.

**Done when** every card is ticked or waits on a need, every Done means step ran green on the built tree, and you reviewed your full diff once to remove near-copies and dead code. Then run `qualitylayer build done` (`missing` names what to settle). Verify is yours too: go straight on with its reply in the same turn, without a report, until the page turns to the person.

## Cut the slices

1. **Vertical slices** matching `**Size:**`: thinnest end-to-end path first, then biggest unknown. Each slice commits on its own (export + callers together). A small task is one slice.
2. **Write cards** under *Task cards* in `agents/{implement_doc}` (`T1`, `T2` …). State done behaviors, failure modes, tests with two real inputs (one awkward), and approved copy verbatim. **Files** lists every touched repo path (source, tests, fixtures, docs, lasting models; never task records/evidence/drafts; `none` for evidence-only tasks with **Read only** paths).
3. **Order the proof:** add `## Proof order` (`A3 · after slice 2`, adding `(the person confirms it in Verify)` for human-only steps). Add any missed boundary/cancel/concurrency step via `qualitylayer plan amend --by agent --note "<step and why>"`, then run `qualitylayer validate agents/{implement_doc}`.
4. **Unattended safe commands** from repo root; only push/deploy/call remote systems granted in *Prerequisites*. Run paid/real-agent commands in one card and cite its result elsewhere (`QUALITYLAYER_CHECK_TIMEOUT_MS` up to 7200000).

Cards are yours to edit or split. Only changing what the person approved requires editing `{plan_doc}` and running `qualitylayer plan amend --by agent --note "<what and why>"` (ending `"changes what you approved: ..."` if an approved point cannot be met).

## Build, card by card

1. `qualitylayer progress "<current work>" --for T<n>` before you edit. For parallel helpers, agree shared interfaces first with disjoint Files. Write one progress line per card as its helper starts.
2. Write the test before the code for user- or caller-facing behavior. For pure rules, parsers, policies, or state transitions, prefer an exhaustive table sweep, seeded multi-step event sequence against a small independent reference model, or property test in the repo's existing runner (no new dependency just for tests; mix valid prefixes/states with adversarial cases) — seen red before green, or rejecting a broken output when covering existing code, so a stub cannot pass.
3. For UI changes, inspect each changed state at real width in light and dark.
4. `qualitylayer check task T<n>` records its focused check; tick the card (`- [x]`) when its done lines hold, before its dependent work starts. Fix failures yourself (if a fix fails twice, change the mechanism; a failure predates the task only if it fails on base). On concurrent edits, `check slice` re-runs on HEAD + slice files. After a rebase, inspect `qualitylayer doctor --json` and registered commits.
5. Finish each slice with `qualitylayer check slice <n>`. Under `commit_timing: slice` (default), run `qualitylayer commit slice <n>` (`--commit <fullsha>` for manual commits). Under `before-verify` or `review`, keep slices in the worktree and run `qualitylayer check all` before `qualitylayer build done` (`review` opens a person decision; in terminal, show exact actions from `qualitylayer commit task`, apply requested edits and recheck). Keep `left_out` (other sessions' edits) out. A tick never waits for a commit.
6. Run due Done means steps (*Proof order*) with `check step` (command fails unless full Expected holds); defer person-only steps via `qualitylayer build done --defer "<step and why>"`.

## Limits

- **A pass is one you saw.** Keep recorded exit codes; quote remote proof by its log line.
- **Push only** a verification deploy the Plan grants; keep repo hooks.
- **Person-only blockers** (secret, login, account, paid service, permission): `qualitylayer need "<what. why you cannot>" --for T<n>`, closed with `qualitylayer need resolved T<n>`. Decide everything else yourself; only when truly person-only and unable to wait for Verify, ask once with `qualitylayer question ask` and keep building.
- **Mid-build user additions:** add `> [!ADDED] build · <why>` to `{plan_doc}` and run `qualitylayer plan amend --by user --note "<their words>"` (draw visible UI additions for approval first; record as a need meanwhile). Record unremovable limits with `qualitylayer limit add`.
- **Additional checkout** named under Scope › In scope as `` - **Repository:** `/absolute/path` ``: run `qualitylayer check task T<n> --repo <checkout>` and register manual commits with `qualitylayer commit slice <n> --commit <hash> --repo <checkout>`.

## The record

QualityLayer writes `{implement_doc}` and `records/checks.md`. Keep `agents/{implement_doc}` current (slice status, environment, dead ends, notes, and *For Verify*). After compaction, re-read the Plan and agents' files. Keep modules single-responsibility behind clear interfaces.

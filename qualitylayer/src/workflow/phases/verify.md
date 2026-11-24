# Verify: checks, independent review, your fixes, then the person's review

Verify proves the built change with records and fixes every gap so the person's review opens finished. Implement's limits stand. QualityLayer fills `{verify_doc}` between `<!-- ql:... -->` markers; work lives in `agents/{verify_doc}`.

**Done when** `qualitylayer check all` passes on the final source (or is red on base too) and every Done means point passes as approved or amended. The page then turns to the person.

## The order

1. **Security review** in parallel when a trust boundary is crossed (Plan's line, state-writing endpoints, agent instructions, hooks, installers, CI). Fix critical/high findings before step 3; unreached scope is `**Result:** unverified`, never clean.
2. **`qualitylayer check all`** before the reviewer starts. Save redacted local output for Done means steps with `qualitylayer evidence add --run <id> --mode scripted|real-session --step A<n> <file>`. A red check is yours to fix; use `qualitylayer check all --base` when a test already fails on base (a base-failing test is excused by name; lint/type/build never is — ask the person at once with `qualitylayer question ask`).
3. **`qualitylayer verify judge`** starts the independent review (single judge, or split acceptance helpers + diff judge). Leave the checkout alone while they work. QualityLayer commits the judge's tests with its pass.
4. **Second opinion** (when on) runs beside the reviewer: answer every finding `Answer: Taken · <what changed>` or `Answer: Kept · <why>`. With Independent review off, check Done means yourself.
5. **Fix gaps** (`qualitylayer verify fix`), then `qualitylayer verify recheck` (rechecks failed items + changed lines only). Add a regression test for each fixed bug (red before, green after). **Before calling `verify recheck`, re-run the previous round's failing cases alongside the new fix** so one fix does not regress another. Test/doc-only commits need `qualitylayer check all`, not a recheck.
6. **`qualitylayer check all` once more** on the final source.

## Failure bar & limits

The judge's failure bar governs the round (unmet Done means, build-caused red check, critical/high security finding, lost data, or reproduced bug in changed lines). **A reproduced bug is never Kept** (`[NOTE] bug:` included): fix test-first, or name an external follow-up with owner.

- A verdict is its reviewer's: never rewrite it. Send factual errors back to that reviewer.
- In a shared checkout, `check all` isolates foreign unfinished edits on a copy of HEAD + this task's files.
- Person-only state/access is a need before the next reviewer starts: `qualitylayer need "<what. why you cannot>" --for T<n>`, closed via `qualitylayer need resolved T<n>`.
- **Park unchanged `environment:` blockers after 1 round:** if an external outage, missing credential or spend cap has not changed since the last round, do not start another judge round against it — record a `need` or ask the person once via `qualitylayer question ask` and continue unblocked work.
- Person-only steps or ungranted pushes/runners never hold Verify; redeploy only to a Plan-granted non-production target.

## When it does not pass

Keep fixing and rechecking while you can make meaningful progress within approved scope. If a result is unchanged, change the approach or diagnose the cause before another recheck, and log what you tried under *Fix rounds*.

When blocked on an external/environment issue, timeout, or person-only decision, `qualitylayer next` names the exit and move:
- **Outside the task** (foreign work, pre-existing base failure): log follow-up + owner under *Fix rounds*.
- **Inside the task**: ask once via `qualitylayer question ask` (`question`, `recommended`, `why`). In App mode, keep doing unblocked work while open; in terminal mode, finish independent work before opening the picker. If the person explicitly replies to the exit question in chat while `answers` is `app`, record their exact words via `qualitylayer question answered "<their words>"` instead of stalling. Choices: **Change what Done means** (`qualitylayer plan amend --by user`), **One more fix round** (`qualitylayer verify fix`), **Stop the task** (`qualitylayer task abandon`), or (red project checks only) **Keep it red and review it** (`qualitylayer verify keep-red`). A failing point becomes a pass only by passing.

For a recorded Verify need, `question ask` may bind `ownerRequest` (`need`, `since`, `kind`: `budget` with `amountCents`, or `evidence` for redacted proof/links, never credentials). A need or saved answer is never a verdict.

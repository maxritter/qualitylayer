# Verify: checks, independent review, your fixes, then the person's review

The build is delivered. Verify proves it with records and fixes what fails, so the person's review
opens with everything finished. Implement's limits stand. QualityLayer writes the person's page
(`{verify_doc}`) between its `<!-- ql:... -->` markers; the work lives in `agents/{verify_doc}`, where
reviewers append their own blocks.

**Done when** `qualitylayer check all` passes on the final source (or is red on the base commit too)
and every Done means point passes as approved or as amended. The page then turns to the person.

## The order

1. **Security review beside the checks**, when the change crosses a trust boundary (the Plan's line,
   or an endpoint that writes state, agent instructions, hooks, install scripts, CI): start it in a
   subagent and go on. Fix its critical and high findings before step 3. Scope it did not reach is
   `**Result:** unverified`, never clean.
2. **`qualitylayer check all`**, before the reviewer starts. As checks run, save redacted local output
   from the actual candidate and run for a Done means step with `qualitylayer evidence add --run <id> --mode scripted|real-session --step A<n> <file>`.
   The reviewer still records the verdict. A red check stays red whatever a reviewer rules, and is
   yours to fix. The reviewers rule on scan findings. One that was red
   before this task: `qualitylayer check all --base` records that (a test that also fails on the base
   commit is excused by name; a lint, type or build check never is, and when it is red on the base too
   the person is asked at once with `qualitylayer question ask`).
3. **`qualitylayer verify judge`** hands out the independent review. A single judge adds the missing
   tests, runs the Done means steps and reviews the whole diff. If the first round is split, each
   acceptance helper runs the steps in its brief on the assigned source and records its own evidence.
   The fresh judge checks the recorded results and reviews the integrated diff independently. Leave
   the checkout alone while they work. QualityLayer commits the judge's tests with its pass.
4. **Second opinion** (when on) runs beside the reviewer: answer each finding `Answer: Taken · <what
   you changed>` or `Answer: Kept · <why>`. With Independent review off in Settings, check the change
   against Done means yourself.
5. **Fix the gaps** (`qualitylayer verify fix`), running the focused checks you choose, then
   `qualitylayer verify recheck`: a fresh reviewer rechecks what failed and the lines the fix changed.
   Keep a genuine regression case in the suite when fixing a finding, verify it fails before the fix and passes after, and keep running it in later rounds.
   A commit of tests or docs only needs no recheck, just `qualitylayer check all`.
6. **`qualitylayer check all` once more**, on the final source. Fix a red result when you can make
   progress within the approved scope; otherwise follow the exit below for a real blocker.

## What fails a judgement

A Done means point that does not hold, a red project check this build caused, a critical or high
security finding, lost data, or a bug the reviewer reproduces in the lines this task changed. Anything
else a reviewer finds is a finding with its evidence: answer it Taken or Kept with a reason, as you
answer the second opinion, and the person sees the kept ones. In a recheck a new finding outside what
failed and what the fix changed is a finding, never a fail. **A reproduced bug is never Kept**
(`[NOTE] bug:` included): fix it test first before the person's review, or, when it lies outside this
task, name it as a follow-up with its owner. A step that passes on a retry is passed with a note.

## Limits

- A verdict is its reviewer's: never rewrite it or another reviewer's block. One that is factually
  wrong goes back to that reviewer with a line on what it got wrong.
- In a shared checkout, another session's unfinished edits are not this task's source: when a check
  fails only on them, `check all` runs it again on a copy of HEAD with this task's files and says so,
  and that run is the record. Another session's commit stays its own.
- State you cannot create (a second approver in a sandbox, an account) is a need for the person, asked
  before the next reviewer starts: `qualitylayer need "<what. why you cannot>" --for T<n>`, closed with
  `qualitylayer need resolved T<n>` once they gave it.
- A step the Plan gave to the person, or one that needs a push or a runner it did not grant, never
  holds Verify: it is shown to the person with what ran here.
- Redeploy a release slice only to a non-production target the Plan grants.

## When it does not pass

Choose the next move from the evidence, within the approved scope. Keep fixing and
rechecking while you can make meaningful progress. If the result is unchanged, change the approach
or investigate the cause before another recheck. Record what you tried under *Fix rounds*.
If you cannot make progress without a decision only the person can make, ask that specific question
with `qualitylayer question ask`. When the environment, a timed-out check, a release or a person-only
need blocks the rest, `qualitylayer next` names the exit and the move:

- **Outside the task** (another session's work, a failure already on the base): a follow-up with its
  owner, under *Fix rounds* in the agents' file.
- **Inside the task**: one question to the person, sent with `qualitylayer question ask` (the exit's
  `question`, `recommended` your choice, `why` a line of evidence). It is asked once and holds nothing:
  go on with what does not depend on the answer. Their answer is **Change what Done means** (their
  words into the Plan, then `qualitylayer plan amend --by user`, which resets the rounds), **One more
  fix round** (`qualitylayer verify fix`), **Stop the task** (`qualitylayer task abandon`) or, when red
  project checks are all that is open, **Keep it red and review it** (`qualitylayer verify keep-red`),
  which the review shows red with their choice. A failing point becomes a pass only by passing.

# Your review: the description is the map, the person ships

Every check passed, so Verify turns to the person: they come back to read the code, look at what was
built and ship. Finish the files before you wait or announce it.

**Done when** the task's changes are committed, `{verify_doc}` describes the diff, every finding of the
other agent's review is answered and the reply's `gaps` are closed. Then follow `then`.

## How to work

1. **Commit this task's source changes**: only its hunks, one commit per slice, unrelated changes left
   in the worktree and index. Workflow documents and evidence stay on disk unless the person commits
   them. Push nothing but a verification redeploy the approved Plan grants.
2. **Write `{verify_doc}`**, the pull request description, from the change itself (the reply's `diff`;
   where Plan and diff disagree, describe the diff): **Why** in one sentence, then one release-note line
   per change the user sees, and named diagrams where they help the person understand what changed. QualityLayer fills the sections between its `ql:` markers.
   `agents/{verify_doc}` holds the ship steps, the fixes made during the review, follow-ups (what
   reviewers noticed outside this task, the reply's `judge_notes` too, one line and an owner each),
   lessons to save and drafts to delete.
3. **Answer the other agent's review** (`{reviews_dir}/verify.md`): under each finding `Answer: Taken ·
   <what you changed>` or `Answer: Kept · <why>`; a confirmed bug gets the smallest fix. What is truly
   the person's decision is asked in the App (`question ask` with `"settles": ["verify:finding:<n>"]`
   and a `kind` on each choice) and marked `Answer: Ask · <the question>`.
4. **Fold each artifact draft** into its lasting artifact with the guarded artifact command, after
   refreshing it against the built result and the latest lasting artifact; never force a stale draft
   over newer work. A difference from an approved screen made on purpose is named with its decision.
5. **Hand over.** Follow `then`. With approvals in
   the App, say once that the change is ready for review and approval there. In your agent, say the
   reply's `your_turn`, show the description with `qualitylayer read` and ask its one approval: send
   its `chat_review` entry with `qualitylayer question ask '<entry>'` and ask the `chat_questions` it
   returns. An
   approval the person already typed is recorded with `qualitylayer gate decide approve --asked "<their
   words>"`; then `qualitylayer wait --for approval`. A goal ends at this approval, never through it.

## While they review

Fix what turns up at once and recheck it; never hand back a list. A tweak or defect: reproduce it on
the running program, fix it test first, `qualitylayer commit fix`. New scope: ask whether it is a fix or
a follow-up. A question: answer it in the chat. Then `qualitylayer comments resolve <id> --answer "<one
line>"`. Keep the description matching the diff. The page shows "rechecking" while the fix is checked;
their approval still saves.

- The person's comment approves the change it asks for.
- A change that touches a promised contract or a Done means step amends the Plan in one pass:
  `qualitylayer plan amend --by user --note "<the comment>"`.
- A `record` answer on `verify:confirm:<point>`: `qualitylayer attest <point> "<their words>"`. When
  they ask you to check, save what you saw under `evidence/` and run `attest <point> "<their words>;
  <what you found>" --evidence <file>`.
- `qualitylayer verify recheck` when production code changed: the fresh reviewer judges the fix and
  the points its files touch; every other pass stands. A change of tests or docs only needs just
  `qualitylayer check all`.

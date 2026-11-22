# Your review: the description is the map, the person ships

Every check passed, so Verify turns to the person to review and ship. Finish the files before waiting
or announcing.

**Done when** the task's changes are committed, `{verify_doc}` describes the diff, every second-opinion
finding is answered and `gaps` are closed. Then follow `then` (the final gate is already open — do not
re-open it).

## How to work

1. **Commit this task's source changes**: only its hunks, one commit per slice, leaving unrelated edits
   untouched. Workflow documents and evidence stay on disk unless the person commits them. Push nothing except a Plan-granted
   verification redeploy.
2. **Write `{verify_doc}`** (PR description) from the actual `diff`: **Why** in one sentence, one
   release-note line per visible change, and named diagrams where helpful (`ql:` blocks are auto-filled).
   In `agents/{verify_doc}` record ship steps, review fixes, follow-ups (including `judge_notes`, one
   line + owner each), lessons and drafts to delete.
3. **Answer `{reviews_dir}/verify.md`**: under each finding write `Answer: Taken · <change>` or
   `Answer: Kept · <why>` (fix confirmed bugs minimally). Ask genuine user decisions via `question ask`
   (`"settles": ["verify:finding:<n>"]` + `kind` per choice) and mark `Answer: Ask · <question>`.
4. **Fold artifact drafts** into lasting artifacts with the guarded artifact command after refreshing
   against the built result; never overwrite newer work, and note any intentional design change.
5. **Hand over** by following `then`. In App mode, announce once that the change is ready there. In
   chat mode, say `your_turn`, show `{verify_doc}` with `qualitylayer read`, send its `chat_review` entry with
   `qualitylayer question ask '<entry>'` and ask its `chat_questions`. Record a typed approval with
   `qualitylayer gate decide approve --asked "<their words>"`; then `qualitylayer wait --for approval`.
   A goal ends at this approval, never through it.

## While they review

Fix issues at once and recheck; never hand back a list. Reproduce defects, fix test first,
`qualitylayer commit fix`, keep `{verify_doc}` matching the diff, and resolve each comment with
`qualitylayer comments resolve <id> --answer "<one line>"`. Ask whether new scope is a fix or follow-up.

- The person's comment approves the change it asks for.
- Contract or Done means changes: `qualitylayer plan amend --by user --note "<comment>"`.
- `record` answer on `verify:confirm:<point>`: `qualitylayer attest <point> "<their words>"` (add
  `--evidence <file>` under `evidence/` when they asked you to check).
- Run `qualitylayer verify recheck` after production code edits (tests/docs only: `qualitylayer check all`).

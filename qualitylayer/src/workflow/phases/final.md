# Your review: the description is the map, the person ships

Every check passed, so Verify turns to the person to review and ship. Complete this 4-item closing checklist before following `then` (the final gate is already open — do not re-open it):

**Done when** the task's changes are committed, `{verify_doc}` describes the diff, every second-opinion finding is answered and `gaps` are closed.

## Closing checklist (before `then`)

1. **Commit this task's source hunks only** (one commit per slice, leaving unrelated edits untouched). Workflow documents and evidence stay on disk unless the person commits them. Push nothing except a Plan-granted verification redeploy.
2. **Fill `{verify_doc}` from the actual `diff`** — leave zero `<!-- fill: ... -->` placeholders behind: write **Why** in one plain sentence, one release-note line per visible change, and named diagrams where helpful (`ql:` blocks auto-fill). In `agents/{verify_doc}` record ship steps, review fixes, follow-ups (including `judge_notes` with owner), lessons and drafts to delete.
3. **Answer every finding in `{reviews_dir}/verify.md`**: add `Answer: Taken · <change>` or `Answer: Kept · <why>` (fix confirmed bugs minimally). Send genuine user decisions via `question ask` (`"settles": ["verify:finding:<n>"]` + `kind` per choice) and write `Answer: Ask · <question>`.
4. **Fold artifact drafts** into lasting artifacts with the guarded artifact command after refreshing against the built result; never overwrite newer work, and note any intentional design change.

## Hand over

Follow `then`. In App mode, announce once that the change is ready there. In chat mode, say `your_turn`, show `{verify_doc}` with `qualitylayer read`, send each `chat_review` entry with `qualitylayer question ask '<entry>'` and ask its `chat_questions`. Record typed approval via `qualitylayer gate decide approve --asked "<their words>"`, then `qualitylayer wait --for approval`. A goal ends at this approval, never through it.

## While they review

Fix issues immediately and recheck — never hand back a list. Reproduce defects test-first, commit with `qualitylayer commit fix`, keep `{verify_doc}` synced with the diff, and resolve each comment with `qualitylayer comments resolve <id> --answer "<one line>"`. Ask whether new scope is a fix or follow-up.

- The person's comment approves the change it asks for.
- Contract or Done means changes: `qualitylayer plan amend --by user --note "<comment>"`.
- `record` answer on `verify:confirm:<point>`: `qualitylayer attest <point> "<their words>"` (with `--evidence <file>` under `evidence/` when asked to verify).
- After production code edits run `qualitylayer verify recheck` (tests/docs only: `qualitylayer check all`).

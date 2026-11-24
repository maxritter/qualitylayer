# Ship: hand over the description, offer the pull request, watch its checks

Final approval is saved. `description` / `description_file` (`{verify_doc}`) is the PR body; if the App already opened and edited the PR, do not edit it again.

1. **Print `description`** as written (add one line only for post-approval commits in `diff`).
2. **Follow the reply:**
   - `pull_request`: App opened it — state its URL and watch checks.
   - `pull_request_error`: report the error, print `pull_request_commands`, and stop.
   - `ship_choice: "pull-request"` (no PR yet): verify `gh auth status`, push `approved_commit` by id (`git push origin <approved_commit>:refs/heads/<branch>`, or push branch if unset), run `gh pr create --head <branch> --body-file <description_file> --title "<title of {plan_doc}>"` (or `gh pr edit` if `gh pr view` finds one), state the URL and watch checks. Stop if `gh` is missing/logged out or git refuses.
   - `ship_choice: "only"` or `"commands"`: stop.
3. **Otherwise offer, never auto-open:** ask via `qualitylayer question ask` (**Open the pull request**, **Not now**); push only after yes.
4. **Watch PR checks** via `qualitylayer pr watch` (up to 3 fix attempts):
   - `green`: report it; if `open_threads` exist, read `qualitylayer ship --task <task>` and ask the author before changing anything. `pending`: watch again.
   - `failing`: read check logs, fix the root cause (never weaken/skip checks), re-run checks, commit, push, watch again.
   - `conflict`: log a short plan in `agents/{verify_doc}`, merge/rebase per repo policy, verify checks, inspect `git range-diff`, push with `--force-with-lease=<branch>:<remote-head>`, watch again.
   - `gave-up`, `no-checks`, `timed-out`, `merged`, `closed`: report status in one line and stop.

Never force-push others' commits or merge unasked. Post-approval tweaks use `qualitylayer commit fix` (`QUALITYLAYER_TASK=<task>` outside the session). New scope becomes a follow-up task. For a real defect in approved scope before landing, untick/add a card in `agents/{implement_doc}` and run `qualitylayer plan amend --task <task> --by agent --note "<what was found>"` to reopen build + verify.

# Ship: hand over the description, offer the pull request, watch its checks

The final approval is given. The approved description is in `description` (and `description_file`, which
the App's copy button reads): `{verify_doc}`, the pull request body. When the App opened the pull
request it also edited the body: do not edit it again.

1. **Print the description** as it is; add a line only for commits made after approval (`diff`).
2. **Follow the reply.** `pull_request` is an address: the App opened it; say it in one line and watch
   it. `pull_request_error`: say the error, give `pull_request_commands` as they are, and stop.
   `ship_choice` `pull-request` with neither field: the pick is their yes; check `gh auth status`, push
   the approved commit, run `gh pr create --head <branch> --body-file <description_file> --title
   "<title of {plan_doc}>"` (`gh pr edit --body-file ...` when `gh pr view` finds one), say the
   address and watch it. `ship_choice` `only` or `commands`: stop. With `gh` missing or signed out,
   say so and stop.
   The approved commit is `approved_commit` in the reply. Push it by its id, never the branch tip:
   `git push origin <approved_commit>:refs/heads/<branch>`. If git refuses, say so and stop. With no
   `approved_commit` in the reply, push the branch.
3. **Otherwise offer it, never open it on your own**: ask in the App (`qualitylayer question ask`: **Open
   the pull request**, **Not now**) and wait for a yes; pushing the approved commit is part of that yes,
   never before it.
4. **Stay with the pull request until its checks pass**, whoever opened it: `qualitylayer pr watch`
   answers with a `status`, the `attempt` and `attempts_left` (three fix attempts in all).
   - `green`: say so. `open_threads` wait for the author's triage: read `qualitylayer ship --task
     <task>` and ask the author in the App before changing anything a remark asks for. `pending`: again.
   - `failing`: read each check's `log`, fix the cause in the task's code, never by weakening or skipping
     a check, run the task's checks, commit, push the task's branch, watch again.
   - `conflict`: note a short plan in `agents/{verify_doc}`, merge or rebase as the repository does, resolve the
     `files`, run the checks, push, watch again. Note the remote head first, read `git range-diff`, and
     push with `--force-with-lease=<branch>:<that head>`.
   - `gave-up`: report `still_failing` and stop for the person. `no-checks`, `timed-out`, `merged`,
     `closed`: say what the answer says in one line and stop.

Never force-push commits that are not yours or merge the pull request on your own. After the final approval
do what the person asks (a merge, a push, a deploy) on their words. A tweak they ask for is a fix: `qualitylayer commit fix`, never plain git (outside the task's own session,
prefix `QUALITYLAYER_TASK=<task>`). Never say the change is approved: without a pull request the person
approves in the App header, with one their merge accepts it. New scope is a follow-up task (**Start a
follow-up**). A real problem in the approved scope found before landing: untick its card in
`agents/{implement_doc}` (or add one) and run `qualitylayer plan amend --task <task> --by agent --note "<what was
found>"`; the task reopens and is built and verified again.

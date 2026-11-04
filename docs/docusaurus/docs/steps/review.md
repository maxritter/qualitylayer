---
title: Review
description: Review the code, screens and checks, then approve the change. Open a pull request when you choose.
---

![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-light.svg)
![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-dark.svg)

Review the code, screens and checks, then approve the change. Unverified results stay unverified after approval.

![Review in the App: code review, checks and screens, with one final approval in the page header](pathname:///img/app/review-light.webp)
![Review in the App: code review, checks and screens, with one final approval in the page header](pathname:///img/app/review-dark.webp)

*Example task in a fictional project.*

## Review the result {#items}

| Part | What you read |
| --- | --- |
| **Code** | The complete change, with line comments |
| **Change map** | Where the change landed on the Plan's or Research's map; with a Plan map, what was built as planned and what was not; other changed files listed below |
| **Checks and outcomes** | Every check and its recorded result, including failures and unverified work |
| **Screenshots** | The changed screens and their comparison evidence |
| **Change details** | The complete change record, decisions and amendments |
| **Open items** | What remains unresolved; approval never marks it passed |

Routine choices stay under **Decided while building**. Read them or **Ask why**; none needs a confirmation.

## The page {#the-page}

Code review leads the page. **Checks and outcomes**, **Screenshots** and **Change details** fold below it, retaining the full record.

The top of `07-review.md` becomes the pull request description; the complete record follows. For changed [lasting artifacts](../artifacts.md#lasting), choose which pages to [fold in](../artifacts.md#fold-in).

## Read the code {#code}

![The separate code review workspace with changed files by slice and a split diff, a teammate's question on its line](pathname:///img/app/review-code-light.webp)
![The separate code review workspace with changed files by slice and a split diff, a teammate's question on its line](pathname:///img/app/review-code-dark.webp)

**Review the code** opens the file tree and **Unified / Split** diff. **Viewed** saves reading progress; **All viewed** and **Clear** apply to every file.

### Comment on any line {#line-comments}

Use a line's **+** and pick the kind:

| Kind | What happens |
| --- | --- |
| **Ask** | Sent at once. Your agent answers in the thread without changing any code |
| **Change** | Goes to your agent with your decision. It makes the change test first |
| **Replace with** | A change that carries the exact lines. Your agent applies them as written |

### Findings from the agents {#findings}

Security and second opinion findings appear on their lines. Request a change or record why a finding is not a problem; the reason becomes a [project lesson](../memory.md) for later reviews.

### Ask another reviewer {#another-reviewer}

**Ask another reviewer** chooses an installed agent that did not build the change. It reviews one file or all files, reads the task documents, edits nothing and stops after 8 minutes. Findings and cost appear in the threads.

### Approve with open comments {#open-comments}

Open comments neither block approval nor go to your agent. Opening the pull request posts them as one GitHub review; **Replace with** becomes an applicable suggestion.

### Review with your team {#team-review}

**Ask for review** shows the remote and commits before you confirm the push. Teammates with a checkout can comment on lines; others see the walkthrough and file names ([sharing details](../team/plans.md#privacy)).

## Approve {#approve}

Approve the whole change in the page header, including when its agent has stopped.

| Choice | What happens |
| --- | --- |
| **Approve** | Nothing is pushed. The conversation stays open for merge, deploy and tweaks |
| **Approve and create PR** | Pushes the task's branch and opens the pull request. Needs `gh` |
| **Copy the git commands** | Run them in your terminal |

![Review comments let you ask a question or request a change before final approval](pathname:///img/diagrams/comments-light.svg)
![Review comments let you ask a question or request a change before final approval](pathname:///img/diagrams/comments-dark.svg)

### After you approve {#after-approve}

![Review after the approval: Not merged yet, with requests for the chat and Mark as merged](pathname:///img/app/review-approved-light.webp)
![Review after the approval: Not merged yet, with requests for the chat and Mark as merged](pathname:///img/app/review-approved-dark.webp)

Ask your agent to merge, push, deploy or run end-to-end tests. These actions still need your request.

| Review shows | What you do |
| --- | --- |
| **Not merged yet** | Merge as usual. Merged on the web? Pull the base branch, or press **Mark as merged** |
| **1 change since your approval** | Your agent committed a tweak. Press **View the change**, then **Approve change** in the header. With an open pull request, your merge accepts it |
| **Merged into main** | The task is in **Shipped**. New work starts with **Start a follow-up** |

QualityLayer recognizes local merges, including squash and rebase, and checks pull requests it opened on GitHub. For work built directly on main, only that task's fixes count ([details](implement.md#where-it-lands)). While a pull request is open, your agent [watches checks](pull-request.md#watch) and [handles review threads](pull-request.md#waits).

## Stop, archive or delete a task {#stop-archive-or-delete-a-task}

| | How | What stays |
| --- | --- | --- |
| **Stop** | Tell your agent | The documents |
| **Archive** | The task header (**More** on compact screens); **Restore** undoes it | Everything |
| **Delete** | Confirm **Delete for good** in the task header | Task documents and local records are permanently removed; repository code and branch stay |

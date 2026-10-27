---
title: Review
description: Review the code, screens and checks, then approve the change. Open a pull request when you choose.
---

![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-light.svg)
![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-dark.svg)

The final approval is yours. Review opens the code alongside the complete change, screens and checks. Unverified results stay unverified when you approve.

![Review in the App: code review, checks and screens, with one final approval in the page header](pathname:///img/app/review-light.webp)
![Review in the App: code review, checks and screens, with one final approval in the page header](pathname:///img/app/review-dark.webp)

*Example task in a fictional project.*

## Review the result {#items}

| Part | What you read |
| --- | --- |
| **Code** | The complete change, with line comments |
| **Checks** | Every check and its recorded result, including failures and unverified work |
| **Screens** | The changed screens and their comparison evidence |
| **Change details** | The complete change record, decisions and amendments |
| **Open items** | What remains unresolved; approval never marks it passed |

Routine choices stay under **Decided while building**. Read them or **Ask why**; none needs a confirmation.

## The page {#the-page}

The **Review** page opens code review. **Checks**, **Screens** and **Change details** fold below it; each keeps its full content. Supporting records hold full paths, commits and evidence.

`07-review.md` keeps the complete record in pull request order; its top becomes the pull request's description. If the task changed a [lasting artifact](../artifacts.md#lasting), you pick which pages to [fold in](../artifacts.md#fold-in).

## Read the code {#code}

![The separate code review workspace with changed files by slice and a split diff, a teammate's question on its line](pathname:///img/app/review-code-light.webp)
![The separate code review workspace with changed files by slice and a split diff, a teammate's question on its line](pathname:///img/app/review-code-dark.webp)

**Review the code** opens the whole change in the full window, like a pull request: a file tree, a **Unified** or **Split** diff, and **Viewed** marks that count only your own progress.

### Comment on any line {#line-comments}

Use a line's **+** and pick the kind:

| Kind | What happens |
| --- | --- |
| **Ask** | Sent at once. Your agent answers in the thread without changing any code |
| **Change** | Goes to your agent with your decision. It makes the change test first |
| **Replace with** | A change that carries the exact lines. Your agent applies them as written |

### Findings from the agents {#findings}

Security review and second opinion findings appear as threads on their lines. Make one your change request, or say why it is not a problem; your reason is saved as a [project lesson](../memory.md) so later reviews do not raise it again.

### Ask another reviewer {#another-reviewer}

**Ask another reviewer** has an installed agent that did not build the change review one file or all of it. It reads the change and the task's documents, edits nothing, stops after 8 minutes, and posts findings as threads with its cost listed.

### Approve with open comments {#open-comments}

Open comments do not block approval and are not sent to your agent. When the pull request opens, they post as one GitHub review on their lines; a **Replace with** becomes a suggestion the author can apply.

### Review with your team {#team-review}

**Ask for review** shows the Git remote and commits, then pushes the task's branch to your team's own remote only when you confirm. Teammates with a checkout comment on lines there; others see the walkthrough with file names. QualityLayer stores the team's encrypted comments, the short lines they quote and the commits they point to, never the code ([What is shared](../team/plans.md#privacy)).

## Approve {#approve}

Use the final approval in the page header. There is one approval for the whole change, even if the build agent has stopped.

| Choice | What happens |
| --- | --- |
| **Approve** | Approves the change locally. You push and open a pull request yourself |
| **Approve and create PR** | Pushes the task's branch and opens the pull request. Needs `gh` |
| **Copy the git commands** | Run them in your terminal |

![Review comments let you ask a question or request a change before final approval](pathname:///img/diagrams/comments-light.svg)
![Review comments let you ask a question or request a change before final approval](pathname:///img/diagrams/comments-dark.svg)

Nothing is pushed or merged without your yes. A task built on your main branch has no branch to open a pull request from ([where the build lands](implement.md#where-it-lands)). Once a pull request is open, your agent [watches the checks](pull-request.md#watch) and works through reviewers' threads ([Pull request](pull-request.md#waits)). Teammates comment in their own App ([Change reviews](../team/changes.md)).

## Stop, archive or delete a task {#stop-archive-or-delete-a-task}

| | How | What stays |
| --- | --- | --- |
| **Stop** | Tell your agent | The documents |
| **Archive** | The task header (**More** on compact screens); **Restore** undoes it | Everything |
| **Delete** | Confirm **Delete for good** in the task header | Task documents and local records are permanently removed; repository code and branch stay |

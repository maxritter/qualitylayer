---
title: Review
description: Settle what agents could not settle for you, look at the result, and approve. Open a pull request when you choose.
---

![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-light.svg)
![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-dark.svg)

The final approval is always yours. After Outline, Implement and Verify, Review brings back the decisions and unverified checks that need you. It shows the whole change with proof for each **Done means** point.

![Visual Review in the App: a captured billing screen with its invoice preview and review controls](pathname:///img/app/review-light.webp)
![Visual Review in the App: a captured billing screen with its invoice preview and review controls](pathname:///img/app/review-dark.webp)

*Example task in a fictional project.*

## Your turn {#items}

| Item | Your answers |
| --- | --- |
| **Only you can confirm** | **I confirm**, or ask the agent to record it |
| **Look at the result** | **Looks right**, or pin a change on the screenshot |
| **Found while checking** | **Accept**, or **Fix it** |

Routine build decisions stay under **Decided while building**. Open the record to read them or **Ask why**; they do not each require a confirmation.

What Verify left open stands first ([two runs](verify.md#rounds)), together with cards the build left unticked and needs it recorded. **Fix open items** runs one more round on just those items; you can also approve with the item open or request changes.

When checks remain unverified, review their disclosure and choose **Accept these limits** or request changes. Accepting limits records your decision; it does not pass the checks or approve the change. Final approval is separate.

## The page {#the-page}

The page, **What changed**, opens with what needs your decision, then a walkthrough of the change, its screenshots and its checks. Open supporting records for full paths, commits or evidence.

`07-review.md` keeps the complete record in the order the pull request description needs, so the page draws the walkthrough instead of following the file. The top of the file becomes the pull request's description. If the task changed a [lasting artifact](../artifacts.md#lasting), you pick which pages to [fold in](../artifacts.md#fold-in).

## Read the code {#code}

![The separate code review workspace with changed files and a split diff](pathname:///img/app/review-code-light.webp)
![The separate code review workspace with changed files and a split diff](pathname:///img/app/review-code-dark.webp)

**Review the code** opens the whole change in the full window, read like a pull request. A file tree lists the changed files, the diff shows **Unified** or **Split**, and **Viewed** marks the files you have read. Your progress counts only your own marks.

### Comment on any line {#line-comments}

Comment on any line with its **+**. Pick what the comment is for:

| Kind | What happens |
| --- | --- |
| **Ask** | Sent at once. Your agent answers in the thread without changing any code |
| **Change** | Goes to your agent with your decision. It makes the change test first |
| **Replace with** | A change that carries the exact lines. Your agent applies them as written |

### Findings from the agents {#findings}

The findings of the security review and the second opinion appear as threads on the lines they are about. Make one your change request, or say why it is not a problem. Your reason is saved as a [project lesson](../memory.md), so later reviews do not raise it again.

### Ask another reviewer {#another-reviewer}

**Ask another reviewer** has an installed agent that did not build the change review one file or the whole change. It reads the change and the task's documents and edits nothing. It stops after 8 minutes, its findings arrive as threads, and its cost is listed.

### Approve with open comments {#open-comments}

You can approve while comments are still open. They are not sent to your agent. When the pull request opens, they post as one GitHub review on their lines, and a **Replace with** becomes a suggestion the author can apply.

### Review with your team {#team-review}

**Ask for review** asks teammates to read the code. It shows the Git remote and the commits first, and pushes the task's branch to your team's own Git remote only when you confirm.

- Teammates with a checkout of the same repository read the code there and comment on lines.
- Teammates without one see the walkthrough with file names.

QualityLayer stores the team's encrypted comments, the short lines they quote and the commits they point to, never the code itself ([What is shared](../team/plans.md#privacy)).

## Approve {#approve}

| Choice | What happens |
| --- | --- |
| **Approve** | Approves the change locally. You push and open a pull request yourself |
| **Approve and open a pull request** | Pushes the task's branch and opens the pull request. Needs `gh` |
| **Copy the git commands** | Run them in your terminal |

![When an answer asks for a change, the button reads Send 1 change](pathname:///img/diagrams/comments-light.svg)
![When an answer asks for a change, the button reads Send 1 change](pathname:///img/diagrams/comments-dark.svg)

Nothing is pushed or merged without your yes. A task built on your main branch has no branch to open a pull request from ([where the build lands](implement.md#where-it-lands)). Once a pull request is open, your agent [watches the checks](pull-request.md#watch) and works through reviewers' threads ([Pull request](pull-request.md#waits)). Teammates comment in their own App ([Change reviews](../team/changes.md)).

## Stop, archive or delete a task {#stop-archive-or-delete-a-task}

| | How | What stays |
| --- | --- | --- |
| **Stop** | Tell your agent | The documents |
| **Archive** | The task header; **Restore** undoes it. Compact screens use **More** | Everything |
| **Delete** | Confirm **Delete for good** in the task header | Task documents and local records are permanently removed; repository code and branch stay |

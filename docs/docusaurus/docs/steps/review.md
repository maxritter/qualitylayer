---
title: Review
description: Review the finished code, what changed and the acceptance test as it ran, then approve the change. Open a pull request when you choose.
---

![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-light.svg)
![The workflow, with Review highlighted](pathname:///img/diagrams/track-review-dark.svg)

Review opens once Verify has passed every point, so everything on the page is finished. Read the code, see what changed, then approve the change.

![Review in the App: the code review first, then what changed, the screens and the acceptance test, with one final approval in the page header](pathname:///img/app/review-light.webp)
![Review in the App: the code review first, then what changed, the screens and the acceptance test, with one final approval in the page header](pathname:///img/app/review-dark.webp)

*Example task in a fictional project.*

## Review the result {#items}

| Part | What you read |
| --- | --- |
| **Why** | A one-sentence refresher of the request, then a release-note line for each change users see; the pull request carries them |
| **Code** | The complete change, where to start reading and contextual requests about any line |
| **What changed** | The change in diagrams, in tabs |
| **Screens** | The designs you approved beside what was built |
| **Acceptance test** | The Plan's test as a row per **Done means** point, opening to its steps with their picture or output, and a mark for whether it ran as a script or in a real agent session; each passed row carries a check |

Anything only you can check, such as your account or a device the agents cannot run, comes to you as a question. What turns up while you review, your agent fixes at once and rechecks.

## The page {#the-page}

Code review leads the page. The diagrams, screens and acceptance test follow for a look and a refresher.

`07-review.md` is the pull request description; its pictures stay on your computer unless you publish them. `agents/07-review.md` holds the ship steps, fixes made during Review, follow-ups and lessons to save. For changed [lasting artifacts](../artifacts.md#lasting), choose which pages to [fold in](../artifacts.md#fold-in).

## Read the code {#code}


**Review the code** opens the file tree and **Unified / Split** diff. **Viewed** saves reading progress; **All viewed** and **Clear** apply to every file.

### Ask about any line {#line-comments}

Select a line and choose **Ask agent**. Conversation opens with its file, revision and selected context in an editable draft. Write your request and send it through your agent's native input, or use the explicit terminal handoff. The request never approves the change or authorizes a push.

### Findings from the agents {#findings}

Security and second opinion findings appear on their lines. Request a change or record why a finding is not a problem; the reason becomes a [project lesson](../memory.md) for later reviews.

### Ask another reviewer {#another-reviewer}

**Ask another reviewer** chooses an installed agent that did not build the change. It reviews one file or all files, reads the task documents, edits nothing and stops after 8 minutes. Findings and cost remain in the local review record.

## Approve {#approve}

Approve the whole change in the page header, including when its agent has stopped. Your approval always saves, also when the code moved after the review or a recheck is running.

| Choice | What happens |
| --- | --- |
| **Approve** | Nothing is pushed. The conversation stays open for merge, deploy and tweaks |
| **Approve and create PR** | Pushes the task's branch and opens the pull request. Needs `gh` |
| **Copy the git commands** | Run them in your terminal |

![Ask agent prepares an editable contextual draft; sending and approval remain separate](pathname:///img/diagrams/comments-light.svg)
![Ask agent prepares an editable contextual draft; sending and approval remain separate](pathname:///img/diagrams/comments-dark.svg)

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

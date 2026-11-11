---
title: Verify
description: Agents that did not write the code check every point and fix what fails. Then you review the code, see what changed and approve.
---

![The three steps, with Verify highlighted](pathname:///img/diagrams/track-verify-light.svg)
![The three steps, with Verify highlighted](pathname:///img/diagrams/track-verify-dark.svg)

Verify is one page in two modes. While the agents check, it is their board: project checks and independent review, then fixes for what fails. Once every **Done means** point is proven, the same page becomes your review: the code first, then what changed and each point as it ran. A failure is never marked passed. The findings, commands and every judged round are in `agents/03-verify.md`.

![Verify in the App while the agents check: the project checks, the independent review and the fix rounds](pathname:///img/app/verify-checking-light.webp)
![Verify in the App while the agents check: the project checks, the independent review and the fix rounds](pathname:///img/app/verify-checking-dark.webp)

*Example task in a fictional project.*

## The checks {#lanes}

Project commands and security scans produce recorded results. Separate agents review the code and its behavior.

![Project checks: tests and types, linters, code health and recorded proof. Independent agents: security review, independent review, design review and an optional second opinion.](pathname:///img/verify/verification-light.webp)
![Project checks: tests and types, linters, code health and recorded proof. Independent agents: security review, independent review, design review and an optional second opinion.](pathname:///img/verify/verification-dark.webp)

**Project checks**

| Check | What it does |
| --- | --- |
| **Project checks** | Tests, types, lint and build run on the commit. Failures are recorded without stopping the workflow; the reviewer rules on them |
| **Code health** | Complexity and duplication in the files your agent changed, reported to it after each turn as feedback. [Code health](../reference/code-health.md) |
| **Security scans** | Local scans for secrets, dependency advisories, GitHub workflows and risky code. Unavailable scans stay **not checked**. [Security scans](../reference/code-health.md#security-scans) |
| **Recorded proof** | A **Done means** point passes only with evidence: a check's output, a captured response, a screenshot or a file |

**Independent agents**

| Check | What it does |
| --- | --- |
| **Security review** | Runs beside the project checks when the change crosses a trust boundary or edits agent controls. Your agent fixes critical and high findings before independent review; remaining findings stay visible |
| **Independent review** | An agent that did not write the code reads the whole diff, adds missing tests, runs each step of the Plan's **Done means** and compares screens with their artifacts. A point is proven when every step under it passes; red checks are evidence. A small task gets one reviewer |
| **Design review** | A separate agent checks each finished design before you see it, unless you change **Design review** in [Settings](../reference/settings.md) |
| **Second opinion** | A reviewer from another agent family checks risky changes when [enabled](../reference/settings.md#second-opinion), or on request. Findings are recorded as **Taken** or **Kept** |

If you turn **Independent review** off in [Settings](../reference/settings.md#independent-review), no fresh agent checks the change; Verify shows **Independent review** as **skipped**.

## Two fix rounds {#rounds}

A review fails on a **Done means** point, a red check, a critical or high security finding, lost data, or a bug it reproduces in the lines the task changed. Your agent fixes it and commits. A fresh reviewer rechecks what failed and the lines the fix changed, running only the checks the fix touches. That can happen twice; a round that fixes nothing ends them early.

## Proof for each point {#live}

The header counts the **Done means** points proven, one tick each. The board shows the four check stages and their status, with cited pictures below. A **Code** row counts the changed files; **View changes** opens them. **Read the record** opens the step document.

## When the checks cannot finish {#when-it-stops}

Failures keep their evidence. A point still failing after the second fix round, a prerequisite only you can supply or an unavailable environment ends the checks with one question: change what **Done means** says, ask for one more fix round, or stop the task. Work outside the task becomes a follow-up with its owner. No answer marks a failing point as passed.

Your agent's native permissions and your explicit stop or pause still apply.

## Review the result {#items}

![Verify ready for you: the code review first, then what changed, the screens and Done means as it ran, with one final approval in the page header](pathname:///img/app/verify-light.webp)
![Verify ready for you: the code review first, then what changed, the screens and Done means as it ran, with one final approval in the page header](pathname:///img/app/verify-dark.webp)

| Part | What you read |
| --- | --- |
| **Why** | A one-sentence refresher of the request, then a release-note line for each change users see; the pull request carries them |
| **Code** | The complete change, where to start reading and contextual requests about any line |
| **Diagrams** | The change in diagrams, in tabs |
| **Interface** | Each screen, switched between **Designed** and **Built** |
| **Done means** | The Plan's points as they ran, each opening to its steps with their picture or output, and a mark for whether it ran as a script or in a real agent session |

Anything only you can check, such as your account or a device the agents cannot run, comes to you as a question. What turns up while you review, your agent fixes at once; the page shows **rechecking** over the part that changed.

`03-verify.md` is the pull request description; its pictures stay on your computer unless you publish them. `agents/03-verify.md` holds the verdicts, fix rounds, ship steps, fixes made during your review, follow-ups and lessons to save. For changed [lasting artifacts](../artifacts.md#lasting), choose which pages to [fold in](../artifacts.md#fold-in).

## Read the code {#code}

**Review the code** opens the file tree and **Unified / Split** diff. **Viewed** saves reading progress; **All viewed** and **Clear** apply to every file.

### Ask about any line {#line-comments}

Select a line and choose **Ask agent**. Conversation opens with its file, revision and selected context in an editable draft. Write your request and send it through your agent's native input, or use the explicit terminal handoff. The request never approves the change or authorizes a push.

### Findings from the agents {#findings}

Security and second opinion findings appear on their lines. Request a change or record why a finding is not a problem; the reason becomes a [project lesson](../memory.md) for later reviews.

### Ask another reviewer {#another-reviewer}

**Ask another reviewer** chooses an installed agent that did not build the change. It reviews one file or all files, reads the task documents, edits nothing and stops after 8 minutes. Findings and cost remain in the local review record.

## Approve {#approve}

Approve the whole change in the page header, including when its agent has stopped. Your approval always saves, also when the code moved after the checks or a recheck is running.

| Choice | What happens |
| --- | --- |
| **Approve** | Nothing is pushed. The conversation stays open for merge, deploy and tweaks |
| **Approve and create PR** | Pushes the task's branch and opens the pull request. Needs `gh` |
| **Copy the git commands** | Run them in your terminal |

![Ask agent prepares an editable contextual draft; sending and approval remain separate](pathname:///img/diagrams/comments-light.svg)
![Ask agent prepares an editable contextual draft; sending and approval remain separate](pathname:///img/diagrams/comments-dark.svg)

### After you approve {#after-approve}

Ask your agent to merge, push, deploy or run end-to-end tests. These actions still need your request.

| Verify shows | What you do |
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

A task started before QualityLayer 14 cannot be continued or approved. It stays in the task list marked **earlier workflow** and opens its documents as plain files in **Files**.

Next: [Pull request](pull-request.md).

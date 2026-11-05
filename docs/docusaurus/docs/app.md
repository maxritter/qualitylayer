---
title: The App
description: Read the work, answer questions and give feedback beside your agent’s conversation.
---

Read the task on the left and work with your agent on the right. Use the desktop App on macOS, Windows or Linux, or run `qualitylayer app` for the same workspace in your browser.

![Home: the sidebar with projects, tasks and plan limits, beside a Needs you section for your questions and approvals and a separate Running section for your agents' work](pathname:///img/app/home-light.webp)
![Home: the sidebar with projects, tasks and plan limits, beside a Needs you section for your questions and approvals and a separate Running section for your agents' work](pathname:///img/app/home-dark.webp)

*Example projects and people are fictional.*

| Part | What it does |
| --- | --- |
| **Sidebar** | **Search**, Home, Team, Artifacts and your tasks and Chats by project. **+** opens a menu: **Task** (Feature or Bugfix) or [Chat](chat.md) |
| **Agent status** | The top-bar chip: working, needs you, quiet or stopped |
| **Step track** | Where the task stands. A person icon marks the two steps you approve |
| **Step page** | The step's result, with questions or approval when needed |
| **Right sidebar** | One row: **Conversation**, **Terminal**, **Files** (or **Details**) and **Feedback** |

## The sidebar {#sidebar}

Projects group tasks by repository, with tasks waiting on you first.

- A row shows the step strip and live agent activity; amber means it needs you.
- The row toggle opens reported task lists (Claude Code, Codex and OpenCode) and helpers.
- Right-click a project to rename, recolor or hide it; right-click a task to rename, archive or delete it.
- The foot shows [plan limits](agents/native.md#plan-limits) or today's cost.

Collapse the sidebar to a narrow rail with Home, Team, Artifacts, one tile for each task that needs you or is running, your plan limits and Settings. Hover a tile to see where its task stands. The sidebar stays expanded or collapsed as you move between tasks.

**View options** filters names, groups and row sizes. **Last activity** filters recorded changes: Any, 24 h, 3 d or 7 d. Working and open tasks stay visible. **Reset filters** clears the filters.

**⌘K** searches actions, projects, tasks and files; **⌘P** opens a file in the current task. Use Ctrl instead of ⌘ on Windows/Linux.

<details>
<summary>More shortcuts in the installed App</summary>

| Shortcut | Action |
| --- | --- |
| **⇧⌘N** | New task |
| **⌘B** / **⌘J** | Toggle the left / right sidebar |
| **⌘1** / **⌘2** / **⌘3** | Home / Team / Artifacts |
| **⌘,** | Settings |

Hover over controls for their shortcuts. Search keeps its project-selection keys; a focused Terminal keeps the agent's keys.

</details>

## Home {#home}

**Needs you** opens questions, approvals, teammate requests, waiting Chats and agents that stopped early. **Running** shows active work. Each list shows ten rows, then **Show N more**. When both are empty, one **All clear** line offers **New task**. A request you typed into New task and closed waits on Home with **Continue**. **Shipped lately** lists your three newest shipped tasks; click its heading to fold it. Notifications arrive when you can act: an agent needs you, it is your turn, or a run stopped early.

![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-light.svg)
![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-dark.svg)

## Answering questions {#questions}

**Your turn** shows one question; use its numbered strip to answer in any order.

<details>
<summary>Answer with the keyboard</summary>

| Key | Action |
| --- | --- |
| **1–9** | Pick a choice |
| **R** / **A** | Take this recommendation / all recommendations in the batch |
| **T** | Write your own answer, then **Send** |
| **M** | **Tell me more** |
| **Enter** | Take the recommendation when the card is focused |

</details>

Answers reach your agent immediately and never approve the Plan or change.

## Documents and feedback {#comments-and-artifacts}

**Files** holds every document, artifact, review and record, plus **Review the code**. **Reader** shows a whole document; its bar holds **On this page**, risky sections and **Copy document**. Working artifacts are compact entries in **Files**; **Open full size** opens the full page.

Select a passage or part of a diagram and choose **Give feedback**. **To** picks the agent, a teammate or **Everyone on the task**.

## Code review {#code-review}

Open **Changes** in the header or **Review the code** in Review or Files. Choose one file or all files, **Unified / Split** diffs, or **Full file › Version** for an exact revision.

**Viewed** records your reading progress. Tick a file or a group, or use **All viewed** and **Clear** for every file. **Finish code review** returns to the view you opened it from. Approving the change remains a separate action.

## What it costs {#cost}

![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-light.svg)
![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-dark.svg)

**Cost** in the task header reads local logs: recorded Copilot AI-credit usage value where available, otherwise verified API-price estimates. Credit value is not additional money billed; partial amounts are labelled. Amounts stay hidden until you open it; unknown values show a dash. **Usage history** opens Settings › Usage.

## Agent runs {#agent-runs}

When you start a task or the build, choose where the agent runs:

| Where | How |
| --- | --- |
| **In the App** (recommended) | Pick agent, model, effort and branch. You answer in **Conversation** |
| **In my terminal** | Ask any coding agent in your own words, or copy the prepared prompt. It asks in its own chat; you can still approve a ready Plan and the final Review in the App |

Closing the sidebar keeps the run. Use **Interrupt** (**Esc**), **Stop session** or **Move to my terminal…** in the agent's menu, and **Resume** to return.

**Conversation** folds finished turns to one line; **Terminal** shows the local program and is omitted from shared tasks. Below the message box are activity, model, effort, [permissions](agents/native.md#permission-modes), pacing and context; each control opens its own details. In **Agent controls › Appearance…**, set thinking to hidden, collapsed (default) or expanded. **Messages while working** defaults to **Steer at next step** where the agent supports it; otherwise it queues without interrupting. Choose **Queue until the turn ends** to wait instead. Queued words and attachments stay when you switch views.

## In Claude Code

A band above your prompt says when something waits for you, and `/task-pane` shows the steps and build progress.

![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-light.svg)
![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-dark.svg)

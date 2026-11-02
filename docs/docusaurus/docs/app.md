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
| **Sidebar** | **Search**, Home, Team, Artifacts and your tasks by project. **+ New** starts a Feature, Bugfix or [Chat](chat.md) |
| **Agent status** | The top-bar chip: working, needs you, quiet or stopped |
| **Step track** | Where the task stands. A person icon marks the two steps you approve |
| **Step page** | The step's result, with questions or approval when needed |
| **Right sidebar** | One row: **Conversation**, **Terminal**, **Files** (or **Details**) and **Feedback** |

## The sidebar {#sidebar}

Projects are repositories on this computer; tasks waiting on you come first, and a detailed row shows its step on a seven-part strip. Right-click a project to rename, recolor or hide it, or a task to rename, archive or delete it. The foot shows your agents' [plan limits](agents/native.md#plan-limits) or today's cost.

**View options** (the sliders icon) filters by name, regroups and sets the row size. **Last activity** (Any, 24 h, 3 d or 7 d) filters by recorded changes; working tasks and the open task stay visible, and **Reset filters** clears them.

**⌘K** (**Ctrl+K**) searches actions, projects, tasks and files; **⌘P** opens a file in an open task; **⇧⌘N** starts a task in the installed App.

## Home {#home}

**Needs you** lists your questions, approvals and teammates' requests; each opens the exact spot. **Running** shows your agents' work. Each list shows ten rows, then **Show N more**. The App notifies you only when you can act:

![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-light.svg)
![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-dark.svg)

## Answering questions {#questions}

**Your turn** shows one question at a time; its numbered strip lets you answer in any order. Press **1–9** for a choice, **R** for the recommended one, **A** for all recommended answers in a batch, **T** to write your own and **Send**, or **M** for **Tell me more**. **Enter** takes the recommendation when the card is focused. Each answer reaches your agent at once and never approves anything.

## Documents and feedback {#comments-and-artifacts}

**Files** holds every document, artifact, review and record, plus **Review the code**. **Reader** shows a whole document; its bar holds **On this page**, risky sections and **Copy document**. Working artifacts are compact entries in **Files**; **Open full size** opens the full page.

Select a passage or part of a diagram and choose **Give feedback**. **To** picks the agent, a teammate or **Everyone on the task**.

## Code review {#code-review}

Open **Changes** in the task header or **Review the code** in Files. The view keeps this workflow’s changes together. Choose one file or all files, switch **Unified / Split**, and use **Full file › Version** to read an exact revision.

**Viewed** records your reading progress. Tick a file or a group, or use **All viewed** and **Clear** for every file. Finishing code review and approving the change are separate actions.

## What it costs {#cost}

![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-light.svg)
![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-dark.svg)

**Cost** in the task header estimates each step from list prices and local logs. Amounts stay hidden until you open it; an unknown price shows a dash. **Usage history** opens Settings › Usage.

## Agent runs {#agent-runs}

When you start a task or the build, choose where the agent runs:

| Where | How |
| --- | --- |
| **In the App** (recommended) | Pick agent, model, effort and branch. You answer in **Conversation** |
| **In my terminal** | Copy one prompt into any coding agent. It asks in its own chat; you can still approve a ready Plan and the final Review in the App |

Closing the sidebar keeps the run. Use **Interrupt** (**Esc**), **Stop session** or **Move to my terminal…** in the agent's controls, and **Resume** to return.

**Conversation** shows messages, finished turns folded to one line; **Terminal** shows the local program. Shared tasks omit Terminal. Under the message box: model, effort, [permission mode](agents/native.md#permission-modes) and context.

## In Claude Code

A band above your prompt says when something waits for you, and `/task-pane` shows the steps and build progress.

![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-light.svg)
![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-dark.svg)

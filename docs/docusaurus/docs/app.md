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
| **Step page** | Questions and approvals, then **Look here** for anything only you can do, then the step's result |
| **Right sidebar** | The task’s **Agent** conversation, **Files** and **Feedback** |

## The sidebar {#sidebar}

Projects are repositories on this computer; tasks waiting on you come first, and each row shows its stage. Right-click a project to rename, recolor or hide it, or a task to rename, archive or delete it. The foot shows your agents' [plan limits](agents/native.md#plan-limits) or today's cost.

**View** regroups and sets the row size. **Last activity** (Any, 24 h, 3 d or 7 d) filters by recorded changes; working tasks and the open task stay visible, and **Clear filters** resets.

**⌘K** (**Ctrl+K**) searches actions, projects, tasks and files; **⌘P** opens a file, **⇧⌘N** starts a task.

## Home {#home}

**Needs you** lists your questions, approvals and teammates' requests; each opens the exact spot. **Running** shows your agents' work. The App notifies you only when you can act:

![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-light.svg)
![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-dark.svg)

## Answering questions {#questions}

**Your turn** shows one question at a time. Press **1–9** for a choice (**Enter** takes the recommended one), **Tab** to write your own and **Send**, or **M** for **Tell me more**. **Skip for now** lets you answer in any order. Each answer reaches your agent at once and never approves anything.

## Documents and feedback {#comments-and-artifacts}

**Files** holds every document, artifact, review and record, plus **Review the code**; **Reader** shows a whole document, and **Copy document** in the document header copies it. Working artifacts are compact entries in **Files**; **Open artifact canvas** opens the full page.

Select a passage or part of a diagram and choose **Give feedback**. **To** picks the agent, a teammate or **Everyone on the task**.

## Code review {#code-review}

Open **Changes** in the task header or **Review the code** in Files. The view keeps this workflow’s changes together. Choose one file or all files, switch **Unified / Split**, and use **Full file › Version** to read an exact revision.

**Viewed** records your reading progress. Mark a file, a group or all files viewed or unviewed. Finishing code review and approving the change are separate actions.

## What it costs {#cost}

![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-light.svg)
![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-dark.svg)

**Cost** in the task header estimates each step from list prices and local logs. Amounts stay hidden until you open it; unknown prices show **tokens unpriced**.

## Agent runs {#agent-runs}

When you start a task or the build, choose where the agent runs:

| Where | How |
| --- | --- |
| **In the App** (recommended) | Pick agent, model, effort and branch. You answer in the **Agent** tab |
| **In my terminal** | Copy one prompt into any coding agent. It asks in its own chat; you can still approve a ready Plan and the final Review in the App |

Closing the sidebar keeps the run. Use **Interrupt** or **Stop** in the agent menu, **Resume** to return, or **Move to my terminal**.

**Conversation** shows the agent's messages, finished turns folded to one line; **Terminal** shows the program. Under the message box: model, effort, [permission mode](agents/native.md#permission-modes) and context.

## In Claude Code

A band above your prompt says when something waits for you, and `/task-pane` shows the steps and build progress.

![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-light.svg)
![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-dark.svg)

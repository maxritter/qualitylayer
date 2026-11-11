---
title: The App
description: Read the work, answer questions and work beside your agent’s conversation.
---

Read the task on the left and work with your agent on the right. Use the desktop App on macOS, Windows or Linux, or run `qualitylayer app` for the same workspace in your browser.

![Home: the sidebar with projects, tasks and plan limits, beside a Needs you section for your questions and approvals and a separate Running section for your agents' work](pathname:///img/app/home-light.webp)
![Home: the sidebar with projects, tasks and plan limits, beside a Needs you section for your questions and approvals and a separate Running section for your agents' work](pathname:///img/app/home-dark.webp)

*Example projects and people are fictional.*

| Part | What it does |
| --- | --- |
| **Sidebar** | **Search**, Home, Artifacts and your tasks and Chats by project. **+** opens a menu: **Task** (Feature or Bugfix) or [Chat](chat.md). With [machines](reference/settings.md#machines), its head switches computers |
| **Agent status** | The top-bar chip: working, needs you, quiet or stopped |
| **Step track** | Where the task stands. A person icon marks the two steps you approve |
| **Step page** | The step's result, with questions or approval when needed |
| **Right sidebar** | One row: **Conversation**, **Terminal**, **Files** |

## The sidebar {#sidebar}

Projects group tasks by repository, with tasks waiting on you first.

- A row shows the step strip, coloured by stage, and live agent activity; amber means it needs you.
- The row toggle opens reported task lists (Claude Code, Codex and OpenCode) and helpers.
- Right-click a project to rename, recolor or hide it; right-click a task to rename, archive or delete it.
- The foot shows [plan limits](agents/native.md#plan-limits) or today's cost.

Keep dragging towards the outer edge after a sidebar stops shrinking to collapse it. Pull the left rail outward to reopen it. The rail keeps Home, Artifacts, waiting and running tasks, plan limits and Settings. Hover a tile for its status. Sidebar state stays as you move between tasks.

**View options** filters names, groups and row sizes. **Last activity** filters recorded changes: Any, 24 h, 3 d or 7 d. Working and open tasks stay visible. **Reset filters** clears the filters.

**⌘K** searches actions, projects, tasks and files; **⌘P** opens a file in the current task. Use Ctrl instead of ⌘ on Windows/Linux.

<details>
<summary>More shortcuts in the installed App</summary>

| Shortcut | Action |
| --- | --- |
| **⇧⌘N** | New task |
| **⌘B** / **⌘J** | Toggle the left / right sidebar |
| **⌘1** / **⌘2** | Home / Artifacts |
| **⌘,** | Settings |

Hover over controls for their shortcuts. Search keeps its project-selection keys; a focused Terminal keeps the agent's keys, including **Ctrl+Enter** for Claude Code's send now.

</details>

## Home {#home}

**Needs you** opens questions, approvals, waiting Chats and agents that stopped early. **Running** shows active work. Each list shows ten rows, then **Show N more**. When both are empty, one **All clear** line offers **New task**. A request you typed into New task and closed waits on Home with **Continue**. **Shipped lately** lists your three newest shipped tasks; click its heading to fold it. Notifications arrive when you can act: an agent needs you, it is your turn, or a run stopped early.


## Answering questions {#questions}

**Your turn** shows one question; use its numbered strip to answer in any order. Choices form one column. Where they have facts, the recommended one is open and the others fold to one line. A question about a screen shows that screen in the card.

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

## Documents and your agent {#comments-and-artifacts}

**Files** holds every document, artifact, review and record, plus **Review the code** and **View changes**; its **Records** row opens `records/`, `evidence/` and `agents/`. **Reader** shows a whole document; its bar holds **On this page** and **Copy document**. Step documents end with **For agents**. Copy includes **Technical** folds. **Copy as Markdown** keeps Mermaid and local picture names; **Copy formatted** includes PNG pictures. Working artifacts are compact entries in **Files**; **Open full size** opens the full page.

Select a passage, code line or artifact spot and choose **Ask agent**. Conversation opens with an editable draft that includes the selected context and revision. Review it and send it through your agent’s native input. With no session, the draft stays while you select an agent. If Conversation input is unsupported, use the explicit terminal/copy handoff. A request never approves a Plan, changes approved scope or settles the final Review.

## Code review {#code-review}

Open **Changes** in the header or **Review the code** in Review or Files. Choose one file or all files, **Unified / Split** diffs, or **Full file › Version** for an exact revision.

**Viewed** records your reading progress. Tick a file or a group, or use **All viewed** and **Clear** for every file. **Exit** returns to the view you opened it from; while your approval waits it reads **Finish code review**. Approving the change remains a separate action.

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

**Conversation** folds finished turns to one line; **Terminal** shows the local program. Below the message box are activity, model, effort, [permissions](agents/native.md#permission-modes), pacing and context; each control opens its own details, a change that must wait for the agent says so on its chip, and a setting the App cannot change shows as text. In **Agent controls › Appearance…**, set thinking to hidden, collapsed (default) or expanded. **Messages while working** defaults to **Steer at next step** where the agent supports it; otherwise it queues without interrupting. Choose **Queue until the turn ends** to wait instead. Paste or drop files in either view. Conversation shows image previews and file cards; queued messages stay when you switch views.

## In Claude Code

A band above your prompt says when this task or another one needs you; `/task-pane` adds the steps, build progress and every task that needs you, runs or has an open pull request.


---
title: The App
description: Read the work, answer questions and give feedback beside your agent’s conversation.
---

Read the task on the left and work with your agent in the right sidebar. Use the desktop App on macOS, Windows or Linux, or run `qualitylayer app` to open the same workspace in your browser.

![A visual billing Plan explains retries, buffering and replay beside Claude Code messages and tool calls in QualityLayer's Conversation view](pathname:///img/app/plan-light.webp)
![A visual billing Plan explains retries, buffering and replay beside Claude Code messages and tool calls in QualityLayer's Conversation view](pathname:///img/app/plan-dark.webp)

*Example task in a fictional project.*

| Part | What it does |
| --- | --- |
| **Sidebar** | **Search**, Home, Team, Artifacts and your tasks by project. **+ New** starts a task |
| **Agent status** | The top-bar chip: the agent's mark and whether it is working, needs you, quiet or stopped |
| **Step track** | Where the task stands. A person icon marks the two steps you approve |
| **Your turn** | One question or decision that needs you |
| **Step page** | What needs you, what to look at, then the part of the step's document that matters now ([how it is built](#step-pages)) |
| **Right sidebar** | The task’s **Agent** conversation, **Files** and **Feedback** |

## Chat {#chat}

**+ New** offers **Chat** beside Feature and Bugfix. Chat starts a direct conversation with Claude Code or Codex. The conversation fills the task page, with **Conversation** and **Terminal** views of the same session and no workflow steps or approval gates.

In App-managed sessions, supported questions appear as clickable choices, with number keys and a typed answer. A task list appears when the agent reports one; expand it to see its statuses. Workflow conversations use the same task list. Outside Codex sessions stay read-only; answer in Codex's terminal. You can resume or archive a Chat like other tasks.

Ask for a saved plan, slice building, artifacts, checks or an independent review as needed. **Start the workflow** asks Feature or Bugfix. **Plan with QualityLayer** continues in Discuss; **Saved plan** starts at Plan from this Chat’s saved plan. Both keep the task and conversation. Chat has no team sharing in this release. See [Chat](chat.md) for the choices and optional tools.

## The sidebar {#sidebar}

Tasks sit under their project (a repository on this computer), those waiting on you first. A project appears when you start a task in it; the folder button adds one by hand. Each task row shows its age, an unread dot, its branch, its pull request with check state, and its agent's mark. **View › Rows** switches between **Detailed** (default), **Two lines** and **One line**.

| To | Do |
| --- | --- |
| Search everything | The **Search** row or **⌘K** ([below](#command-box)) |
| Fold a project | Click its header or press **←**. Folded, it still shows what waits on you |
| Reorder projects | Drag a header, or **⌥↑** / **⌥↓** |
| Rename, recolor or hide a project | The project menu (**⋯** or right-click) |
| Start a task in a project | **+** on its header |
| Rename, archive or delete a task | Right-click it. Archive, Restore and Delete are also in the task header; compact screens keep them in **More** |
| Filter or regroup | **View** (sliders button) |

Project order, colors, names and hidden projects are stored on the computer running the App, so every paired browser shows the same list.

### Usage at the foot {#limits}

The foot of the sidebar shows what your agents have used. An agent on a plan (Claude Code and Codex report theirs) shows the limit window with the least left. An agent billed by use, on an API key or through a gateway, shows today's estimated cost and a seven-day chart. The two are never added together.

Open the block for every limit window, when it resets and a breakdown of use. It is hidden when there is nothing to show. More in [plan limits](agents/native.md#plan-limits) and **Settings › Usage**.

### Search with ⌘K {#command-box}

**⌘K** (**Ctrl+K** elsewhere) opens one box for actions, projects, tasks and the open task's files. Type `›` for only actions, or `/` for only files. **⌘1** to **⌘9** pick a project while the box is open. **⌘U** opens **Settings › Usage**, **⇧⌘N** starts a task and **⌘P** goes to a file.

### The places {#places}

| Place | What it shows |
| --- | --- |
| **Home** | **Needs you** for your tasks and teammate requests, plus your agents' **Running** work ([Home](#home)) |
| **Team** | **My attention**, **Everyone** and **My questions** for shared work |
| **Artifacts** | A compact **Library** grouped by project, with **Archived** and recovery ([Artifacts](artifacts.md#artifacts-place)) |

## Answering questions {#questions}

The App shows your agent's current question on the step it belongs to. Independent questions arrive as a batch. **Your turn** shows one question at a time, and each answer reaches your agent at once.

| Control | Key | What it does |
| --- | --- | --- |
| A choice | **1–9** | Answers. The recommended one is marked (**Enter** or **R** takes it) |
| **Your own answer** | **Tab** | Type and press **Send** |
| **Tell me more** | **M** | Asks for more context first |
| **Skip for now** | | Moves on, so you can answer in any order |
| **Use the recommendations for all N** | | Answers the rest of the batch |
| **Change** | | Corrects an earlier answer, under **Decided with you** |

**↑** / **↓** move between questions. Answering never approves anything: approving the Plan and the change are separate clicks.

## Reading a document {#documents}

Every step writes one Markdown file, shown three ways:

| View | What it shows |
| --- | --- |
| **Step page** | What matters now: **Done means**, decisions with diagrams, slices, checks |
| **Reader** | The whole file, with code shapes, paths and commands |
| **Files** | All seven documents, artifacts, reviews and command records |

**Copy document** in the document header lets you paste a document into Confluence, Notion, Jira or GitHub.

### The step page {#step-pages}

Questions and approvals come first. **Look here** lists anything only you can still do. Below it are the step's summary and main result: requirements, findings, the Plan, the slice board or checked outcomes. Open a row for details, or switch to **Reader** for the whole file.

## Feedback and artifacts {#comments-and-artifacts}

Select a passage, a line or part of a diagram and choose **Give feedback**. The thread keeps that context with your words. The **To** picker chooses the agent, a named teammate or **Everyone on the task** when access is known. Each recipient keeps its own draft. Person-only feedback never goes to the agent.

If a linked document cannot be read for quoted feedback, **Drop quote** keeps your words and attached files as feedback on the document. Review the draft, then press **Send** yourself.

Working artifacts are compact entries in **Files**. **Open artifact canvas** opens the full page. See [Artifacts](artifacts.md).

## Files and Review {#files}

The **Files** tab opens with the task's checkout: its branch and pull request, what the build changed (each file with its mark and plus and minus counts) and a way into **Review the code**. **Open** opens the checkout in your editor. The arrow beside it picks VS Code, Cursor, Zed, Finder or Terminal, saved in **Settings › Git and editor**. Below the card, Files groups Documents, Artifacts, Reviews and Records.

## Home {#home}

![Home: a Needs you section for your own questions and approvals, followed by a separate Running section for your agents' work](pathname:///img/app/home-light.webp)
![Home: a Needs you section for your own questions and approvals, followed by a separate Running section for your agents' work](pathname:///img/app/home-dark.webp)

**Needs you** lists your questions, approvals and tasks you can continue, plus teammates' questions, review requests and replies. Shared rows name the person and open the exact passage, diagram or artifact spot. **Running** shows your agents' work with its current step. Team keeps the shared history.

Set notifications in **Settings › Notifications**. The App notifies you only when you can act:

![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-light.svg)
![Who hears about what: the App, Slack and the Claude Code band speak only when a person can act, and agent progress and checks never notify](pathname:///img/diagrams/attention-dark.svg)

## What it costs {#cost}

![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-light.svg)
![The cost panel: the total, each step with its time, tokens and cost, and each agent named after its work](pathname:///img/diagrams/cost-dark.svg)

The **Cost** control in a task's header opens the cost per step and agent, estimated from list prices and your agents' local logs. Amounts stay hidden until you open it. Unpriced usage shows **tokens unpriced**, so an unknown price is never shown as free. Nothing is sent anywhere.

## Agent runs {#agent-runs}

**New task** offers **Chat**, **Feature** and **Bugfix**. Chat supports Claude Code and Codex ([above](#chat)). Feature and Bugfix default to **Plan with QualityLayer**. Choose **Existing plan** to paste a plan or attach a Markdown or plain-text file, then **Start from this plan**. The original stays unchanged; you review an execution agreement at Plan before the build. Discuss and Research are marked **Not run**. Choose where the agent runs. **Start the build** asks the same last question. A fresh launch starts **In the App**. An unfinished draft keeps your choice. If the agent cannot run there, the terminal option stays available.

- **In the App** (recommended): pick the agent (Claude Code, Codex, Cursor, Grok, Antigravity, Pi or OpenCode), model, effort, project and branch. Its conversation opens in the task’s **Agent** tab, and you answer there.
- **In my terminal**: copy one prompt into any coding agent, app or IDE. Attached files are saved on this computer and listed by path. The agent asks in its own chat; the App shows the questions. Plan and final Review approvals stay available to the owner in the App.

The branch is **Current branch**, **New branch** or **New worktree**. A worktree takes a name that sets its folder and branch, placed next to your project so other work stays untouched.

If the App cannot start the agent here, it says why and keeps the terminal option. Permissions and sign-in prompts still belong to your agent.

| To | Do |
| --- | --- |
| Read the task beside the conversation | Open **Agent** in the right sidebar; drag the divider to resize it |
| Keep working elsewhere | Close the sidebar or open another task; the run continues |
| Type from another window | Use **Take control**; one window types at a time |
| Interrupt or end the run | Use **Interrupt** or **Stop** in the agent menu |
| Return to a saved conversation | Use **Resume** or **Open the conversation** |
| Move to your terminal | **Move to my terminal** gives the supported resume command |

**Settings › Agents** shows each agent's sign-in and how it starts. **Sessions** holds running agents, other paired browsers and quitting the App. **Appearance** holds the terminal's look ([Settings](reference/settings.md#defaults)).

A running process does not prove progress: an agent can wait for a permission, sign-in, answer or approval. Read its status and conversation. **Stop** and a pause you set are always respected. Terminal output stays on your computer and is never part of a shared task.

### The conversation {#conversation}

The **Conversation** view reads the agent's session record. **Terminal** shows the program itself.

- A finished turn folds its thinking and tool calls into one line, such as “Worked for 2 min”. The answer, errors and anything that needs you stay open.
- A file or commit the agent names becomes a chip. A turn that changed files ends with them and their plus and minus counts, recorded outside your repository.
- A strip of marks in the left margin has one mark per turn. Click one, or use the arrow keys, to jump there.
- A long session opens at its last turns. **Show N earlier messages** loads the rest.

The row under the message box holds the **model**, the **effort** (hidden for an agent that has none), the **permission mode** and the **context** ring. It lists each agent's real [permission modes](agents/native.md#permission-modes); a mode that skips every check asks you to confirm. It warns “N % left” when a plan window runs low. Subagents are listed above the box.

## In Claude Code

A band above your prompt says when something waits for you in the App. `/task-pane` opens a pane with the steps and the build's progress.

![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-light.svg)
![The band above the Claude Code prompt: what waits for you in the App, how the build runs, or teammates’ questions for you](pathname:///img/diagrams/band-dark.svg)

---
title: Settings
description: Workflow, agents, plan limits, sessions, notifications, editor, appearance, memory, licence, team and updates, plus the changes you can ask for on one task.
---

Open **Settings** with the gear at the bottom of the sidebar. Settings take the sidebar's place: **Back** returns you to where you were, a search finds a section or a single setting, and the sections run down the left. Each section opens with one line that says what it is for. Changes save at once and apply to every project on this computer.

![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-light.webp)
![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-dark.webp)

| Section | What it holds |
| --- | --- |
| [Workflow](#workflow) | The level of new tasks, your instructions, reviews |
| [Agents](#defaults) | The seven agents, how each starts, the default view, the terminal shell |
| [Usage](#usage) | Plan limits, and what your agents used |
| [Sessions](#sessions) | The agents running now, and when idle ones stop |
| [Notifications](#notifications) | What tells you a task needs you |
| [Git and editor](#git-and-editor) | Git and GitHub status, where files open, pull request watching |
| [Appearance](#appearance) | Theme, task rows, the agent terminal |
| [Memory](#memory) | Lessons your agents keep between tasks |
| [Licence](#licence) | Your plan, billing and activation |
| [Team](#team) | Seats, people, Slack, shared links, team instructions |
| [About](#about) | Version, update channel, the server's port, help and what changed |

## Workflow

### New tasks {#level}

| Choice | A new task starts as |
| --- | --- |
| **Engineering** (default) | The full technical plan, with contracts, files and tests in view |
| **Product** | A product brief in product words, with engineering detail folded away |

Each task keeps its level; change it in the task header until you approve the Plan ([two levels](../intro.md#two-levels)).

### Your instructions {#instructions}

Standing instructions for every task in every project: coding standards, things never to do, how you like a Plan written. **Edit** opens a Markdown editor; **Start from an outline** gives you headings to fill in. Up to 12,000 characters, kept in `~/.qualitylayer/instructions.md`.

| | How it applies |
| --- | --- |
| Who reads it | Your agent once per step, plus helpers and reviewers. Never copied into a task's documents |
| Per step | Lines under a step heading (`## Plan`, `## Implement`, `## Verify`, …) apply to that step only; other lines apply to all |
| Running tasks | An edit applies from the task's next step reply |
| Team instructions | Come first and win on conflict ([Team](#team-instructions)) |
| Approvals | No line can approve a gate |

### Independent review {#independent-review}

Whether an agent that never wrote the code checks the change in [Verify](../steps/verify.md): **On** (recommended) or **Off**. When on, a fresh agent checks the change against each **Done means** point and adds missing tests. The build session fixes findings and requests a recheck; remaining gaps stay visible in Review. Pick its model for each agent: Opus 5.5 by default in Claude Code, GPT-6.1 Sol in Codex, Pi and OpenCode, Auto in Cursor, Grok 4.7 in Grok and Gemini 3.8 Flash (High) in Antigravity. With the setting off, no fresh agent checks any change and Verify records **Checked without an independent judge**.

### Second opinion {#second-opinion}

**Second opinion by** chooses who reviews: **Off** (only when you ask for one on a task), **Other model family**, or a named agent: Claude Code, Codex, Pi, OpenCode, Cursor, Grok or Antigravity.

**Other model family** picks by the model that would do the review, not by the tool that runs it. A candidate is an installed agent that did not build the change and is not signed out. The pick is a candidate whose model comes from a different maker than the model that built the change: GPT reviews Claude, Claude reviews GPT. A model whose maker cannot be told, such as Cursor's Auto, never counts as different. Among those, an agent that enforces read-only itself (everything but Cursor and Antigravity) comes first, then the order Claude Code, Codex, Grok, Pi, OpenCode, Cursor, Antigravity. When only the builder's maker has models at hand, a fresh agent of that maker reviews and Settings says so.

Cursor and Antigravity review a disposable copy and are stopped if they start a tool that is not read-only; a trusted project's hooks may run during any review. A named choice starts a fresh review with that agent's selected model, or with another agent when the named one built the change.

| When | Choices | What it reads |
| --- | --- | --- |
| **On the Plan** | **When risky** (recommended) or **Always** | Discuss, Research and the first full Plan draft, before the Plan reaches you |
| **On the built change** | **When risky** (recommended) or **Always** | The finished code, beside the independent review in [Verify](../steps/verify.md#lanes) |

Risky means the Plan says so, the change touches sign-in, secrets or outside input, or the Outline marks a slice risky. **Always** adds a few minutes per Plan or change. With one agent installed, a separate reviewer of that agent reads instead (Sonnet 5.5 in Claude Code). **Reviewed by** in the Plan names who read it.

Pi and OpenCode can run the same model as another agent, so **Other model family** compares the models the reviewers would use (the **Second opinion** column of **Reviewer models**), not the tools. Give OpenCode a DeepSeek model and it can review Pi's GPT work. See [native agents](../agents/native.md).

### Design review {#design-review}

**Finished designs** (the default) has a fresh agent check each finished design once, about a minute per design. The author fixes what it finds before you see it, and the Plan says so in one line. **Off** shows designs as the author drew them. A wireframe is never reviewed. For work outside a task, `qualitylayer artifact review` writes the same check for your agent to hand on ([commands](commands.md)).

## Agents {#defaults}

**Show agent sessions as** sets the view new sessions open in, **Conversation** or **Terminal**. Each session's own switch changes only its window.

**On this computer** lists the seven agents with their version, sign-in (and plan, where the agent reports one), the state of QualityLayer's integration and a **Use** switch. **Check again** runs a fresh check. An agent that is not installed offers **Install…**, which opens the vendor's install page or shows the command for you to run; QualityLayer never runs an installer. An integration that needs fixing shows **Repair**.

The **⋯** menu on a row offers **Repair skill and hooks** and **Edit launch…**:

| Setting | What it changes |
| --- | --- |
| **Command** | The program that starts the agent, as an absolute path. Empty uses the one found on your computer |
| **Extra arguments** | Added to every start. Arguments that switch off permission checks are refused |
| **Config folder** | Where the agent keeps its settings, for agents that let it be moved |
| **Default effort** | The effort new runs start with. High is recommended; Low appears only when supported. A per-task choice takes precedence |
| **Default permission mode** | The mode a run starts in. A mode that skips every check is chosen per run, never as a default ([modes](../agents/native.md#permission-modes)) |

An environment variable such as `QUALITYLAYER_CODEX_BIN` wins over **Command**, which wins over what is found on your PATH. Changing what starts a program needs the App itself or a browser paired with its key; agents and the command line cannot.

**Another agent** takes the program and arguments of any coding agent that runs shell commands. It gets the request and the CLI instructions in its own terminal. **Terminal › Shell** sets what a plain Terminal opens in a task or artifact.

Choose the agent, model, effort and branch for each run. **Edit launch…** saves an effort default for the agent; a per-task choice takes precedence. Changing it does not alter a running session or the agent's own configuration.

If saved Planning and Implement efforts differ, the sheet shows both. Editing another field preserves them; choosing an effort applies it to both.

Where the agent runs also decides where you answer. **In the App** keeps questions, approvals and artifact feedback in the App or browser; **In my terminal** uses the agent's chat. See [Terminal mode](commands.md#terminal-mode) for CLI controls and document reading.

## Usage {#usage}

**Plan limits** show how much of each plan window is left for Claude Code and Codex. A marker shows where an even pace would leave it, and each window says when it resets. The section says when it last checked. The other agents report no limits, and it says so. The same limits appear at the foot of the sidebar and, in the conversation footer, as the tightest window of the agent in that session. How they are read: [plan limits](../agents/native.md#plan-limits).

**Resume when a limit resets** (on by default) lets a build that stopped on a plan limit continue by itself when the window resets. It only does so if nobody has typed in the session since. You can cancel it on the task.

**What your agents used** adds up the last 7 or 30 days, or this month. It reads the session files your agents keep on this computer and counts each message once. A daily chart shows each agent in its own colour, with the change against the period before. **Where the tokens went** splits the tokens by kind, and **Breakdown** lists every model or every day.

- An agent on a plan shows its limits and its tokens, never dollars. Turn on **Show plan use at API prices** to see what that use would cost at list prices, marked as not billed.
- An agent billed by use (an API key or a gateway) shows an estimated cost, by kind of token and by speed, with what the cache saved.
- Billed by use and on a plan are two figures and are never added together.
- Dollar amounts are estimates at list prices, and your bill can differ. A model with no listed price has its tokens counted and no cost.
- Cursor, Grok and Antigravity keep no token counts, so they show no usage.

## Sessions {#sessions}

**Running now** lists the agents running on this computer. Each row shows the agent, task and project, what it is doing, when its last turn ended and the memory it uses, with a total. Memory is read when you open the page, never in the background. Choose a row to open its task. **Stop idle** stops every idle agent at once. A stopped agent keeps its conversation, and the task's **Continue** resumes it.

**Session rules:**

| Setting | What it does |
| --- | --- |
| **Stop agents that sit idle** | **Never**, after 2 hours, after 8 hours (default) or after a day. It never stops an agent with an open question, approval, turn or helper |
| **Who can type in a session** | **The App and its browsers** (default), or also other paired browsers. Every paired browser can stop a run |
| **When you quit the App** | **Agents keep running** (default), or **Stop agents** |

## Notifications {#notifications}

**Tell me when a task needs me** raises a system notification for a question, an approval or a stopped agent. It opens the exact task, and progress stays quiet. **Play a sound with it** adds a sound, never while you type. **Open Feedback automatically** switches to Feedback when a teammate gives feedback or asks you something, or the agent answers you, never while you type. Slack messages are set in [Team](#team).

## Git and editor {#git-and-editor}

**Tools** shows whether Git and the GitHub CLI (`gh`) are available and signed in. Without `gh`, pull requests are not opened or followed. **Check again** runs the check once more.

**Open files and folders in** picks VS Code, Cursor, Zed, Finder or Terminal. The Files tab, **Review the code** and file chips open there.

**Watch pull requests** (on by default) reads each open pull request while QualityLayer is open. A failing check, a review asking for changes or a conflict appears in **Needs you** and wakes the task's agent, resuming its session if it stopped. It wakes once per event, at most 3 times a day per pull request, and not with less than 10 % of the plan left. Past a limit, the event only shows in Needs you and says why the agent was not woken.

## Appearance {#appearance}

**Theme** is System, Light or Dark. **Task rows** sets how the sidebar draws a task: **Detailed** adds the branch, the pull request with its checks and the agent; **Two lines** and **One line** are shorter.

**Agent terminal** sets how agent sessions look: font size, font, weight, letter spacing, line spacing, colours, a blinking cursor, WebGL drawing and how many lines each terminal keeps. A sample shows the result, and **Reset to recommended** undoes your changes.

## Memory {#memory}

Pause local memory, search saved lessons or retire one. **Manage projects** turns Git sharing on per repository; the choice stays on this computer. More in [Project memory](../memory.md).

## Licence

Your plan or trial days left. **Open billing account** opens qualitylayer.dev/billing (subscription, invoices, seats, payment method). **On another computer** shows the command that moves your licence; if no activation is free, run `qualitylayer licence deactivate` on the old machine or write to hello@qualitylayer.dev. The section also lists what contacts QualityLayer ([Files and privacy](files.md#privacy)).

## Team

| Part | What it holds |
| --- | --- |
| Your name | How your team sees you |
| **People and groups** | Seats, members and their computers |
| **Team instructions** | See [below](#team-instructions) |
| **Slack** | The owner connects the workspace; each person controls messages and an optional morning digest ([Slack](../team/plans.md#slack)) |
| **Shared links** | Each with **Copy** and **Revoke** |

Groups limit who sees a shared task. If another device changes groups while you edit, your input is kept. Unrelated edits can be merged; a conflict on your group offers **Use latest** or **Save my changes** after comparison.

### Team instructions {#team-instructions}

The team owner writes instructions for the whole team in the same editor as [your own](#instructions). They reach every teammate's agent each step, before the teammate's own, and win on conflict. Teammates see them read-only with **View**, with who changed them last. The text is encrypted on the owner's computer with the team's key, and each computer keeps a local copy, so it applies offline too. If two owner windows save at once, the second sees the newer text instead of overwriting it.

## About

The version and **Check now**. The App checks for updates every hour while running, downloads new versions in the background and asks before restarting ([Updates](../install.md#updates)).

**Update channel** is **Stable** (the default) or **Beta**. Stable offers stable releases only. Beta offers betas first, and moves to each stable release once it is newer; switching never takes you back to an older version. Agents and the command line cannot change the channel. **What's new** shows the notes of the releases on your channel. **Something wrong?** sends a report, and **Documentation** opens these pages.

### Server {#server}

**Server port** is where the App and your browsers reach QualityLayer on this computer: 41888 unless you change it, from 1024 to 65535. Type a new port and click **Restart on N**. The setting is saved and the server starts again on that port. The App's window follows the new server on its own, and running agents keep going. A browser tab shows **Open on N** instead of jumping by itself, because that port may need forwarding first ([a port for each machine](../install.md#port)).

**In use now** is the port the server really listens on, with its address and **Copy**. When the port you set was taken at start, the server uses the next free one and says so: "41888 was taken, so it uses 41889. Your setting stays 41888." **Try 41888 again** restarts the server to look at that port once more. Settings reads the server when you open the page; it does not check in the background.

`QUALITYLAYER_PORT` sets the port for one server and wins over this setting. While it is set, the field is off and says so. From the command line: `qualitylayer settings set cockpit.port <port>`, then `qualitylayer app restart`; `qualitylayer app status` prints the port.

## For one task {#for-one-task}

Tell your agent: "skip security", "run the security review", "get a second opinion" or "no second opinion". No setting turns an approval off.

---
title: Settings
description: Configure your workflow, agents, usage, sharing and updates.
---

Open **Settings** with the gear at the bottom of the sidebar; its search finds any setting. Changes save at once for every project on this computer.

![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-light.webp)
![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-dark.webp)

## Workflow

| Setting | Choices |
| --- | --- |
| **New tasks** | **Engineering** (default) or **Product** ([two levels](../intro.md#two-levels)); change per task until the Plan is approved |
| [Your instructions](#instructions) | Standing instructions for every task |
| [Independent review](#independent-review) | **On** (recommended) or **Off** |
| [Second opinion by](#second-opinion) | **Off**, **Other model family** or a named agent |
| **Design review** | **Finished designs** (default): a separate agent checks each finished design before you see it. Wireframes are never reviewed |

### Your instructions {#instructions}

Up to 12,000 characters in `~/.qualitylayer/instructions.md`, read by your agent, helpers and reviewers each step and never copied into documents. Lines under `## Plan`, `## Implement`, … apply to that step only. [Team instructions](#team-instructions) win on conflict. No line can approve a gate.

### Independent review {#independent-review}

**On**: an agent that never wrote the code checks each **Done means** point in [Verify](../steps/verify.md). **Off**: Verify records **Checked without an independent judge**. Default models: Opus 5.5 (Claude Code), GPT-6.1 Sol (Codex, Pi, OpenCode), Auto (Cursor), Grok 4.7 (Grok), Gemini 3.8 Flash (High) (Antigravity).

### Second opinion {#second-opinion}

A second reviewer reads **On the Plan** and **On the built change**, each **When risky** (recommended) or **Always**. Risky means the Plan says so, the change touches sign-in, secrets or outside input, or a slice is marked risky. **Other model family** picks an installed, signed-in agent that did not build the change, from another model maker: GPT reviews Claude, Claude reviews GPT.

<details>
<summary>How the reviewer is picked</summary>

- Pi and OpenCode count by the model in **Reviewer models**; Cursor's Auto never counts as another maker.
- Agents that enforce read-only come first, then Claude Code, Codex, Grok, Pi, OpenCode, Cursor, Antigravity. Cursor and Antigravity review a disposable copy.
- With one agent installed, a separate reviewer of it reads (Sonnet 5.5 in Claude Code). **Reviewed by** in the Plan names who read it.

</details>

## Agents {#defaults}

**On this computer** lists the seven agents with version, sign-in, integration state and a **Use** switch. **Install…** opens the vendor's page; QualityLayer never runs an installer. **Show agent sessions as** picks **Conversation** or **Terminal**.

| **⋯ › Edit launch…** | What it changes |
| --- | --- |
| **Command** | The program's absolute path. `QUALITYLAYER_CODEX_BIN`-style variables win over it |
| **Extra arguments** | Added to every start; ones that switch off permission checks are refused |
| **Config folder** | Where the agent keeps its settings |
| **Default effort** | High is recommended; a per-task choice wins |
| **Default permission mode** | Never one that skips every check ([modes](../agents/native.md#permission-modes)) |

Only the App, or a browser paired with its key, can change these.

## Usage {#usage}

**Plan limits** show remaining Claude Code and Codex usage. **Resume when a limit resets** (on) continues stopped builds unless someone has typed since. **What your agents used** totals 7 days, 30 days or this month: tokens for subscriptions, estimated cost for API accounts. The two are kept separate.

## Sessions {#sessions}

**Running now** lists running agents; **Stop idle** stops the idle ones, which keep their conversation.

| Setting | Choices |
| --- | --- |
| **Stop agents that sit idle** | Never, 2 h, 8 h (default) or a day; never one with an open question, approval, turn or helper |
| **Who can type in a session** | **The App and its browsers** (default), or also other paired browsers |
| **When you quit the App** | **Agents keep running** (default) or **Stop agents** |

## Notifications {#notifications}

**Tell me when a task needs me** enables system notifications; **Play a sound with it** adds sound. **Open Feedback automatically** shows incoming questions and replies.

## Git and editor {#git-and-editor}

**Tools** shows whether Git and `gh` are signed in; without `gh`, no pull requests. **Open files and folders in** picks VS Code, Cursor, Zed, Finder or Terminal. **Watch pull requests** (on) wakes the task's agent on a failing check, change request or conflict, at most 3 times a day per pull request and not below 10 % of the plan left.

## Appearance {#appearance}

**Theme**, **Task rows** (Detailed, Two lines, One line) and **Agent terminal** (fonts, colours, scrollback, **Reset to recommended**).

## Memory {#memory}

Pause, search or retire lessons; **Manage projects** turns Git sharing on per repository ([Project memory](../memory.md)).

## Licence

Your plan or trial, and **Open billing account**. **On another computer** shows how to move the licence; if no activation is free, run `qualitylayer licence deactivate` on the old machine or write to hello@qualitylayer.dev.

## Team

| Part | What it holds |
| --- | --- |
| **People and groups** | Seats and members, with a local name or email search, an **Owner** / **Member** filter and pages of 12. Invited members and **key waiting** badges stay listed. Groups limit who sees a shared task |
| [Team instructions](#team-instructions) | Instructions for every teammate's agent |
| **Slack** | Workspace connection and each person's messages ([Slack](../team/plans.md#slack)) |
| **Shared links** | **Copy** and **Revoke** |

### Team instructions {#team-instructions}

The owner writes them; they reach every teammate's agent before the teammate's own and win on conflict. Teammates read them with **View**. They are encrypted with the team's key and kept locally, so they apply offline.

## About

The version, **Check now** and **Update channel**: **Stable** (default) or **Beta**, which also moves to each newer stable release ([Updates](../install.md#updates)).

### Server {#server}

**Server port** is 41888 unless you change it (1024 to 65535); type one and **Restart on N**. **In use now** shows the real port, for example "41888 was taken, so it uses 41889." `QUALITYLAYER_PORT` overrides it for one server; `qualitylayer settings set cockpit.port <port>` sets it from the command line.

## For one task {#for-one-task}

Tell your agent "skip security", "run the security review", "get a second opinion" or "no second opinion". No setting turns an approval off.

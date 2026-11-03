---
title: Settings
description: Configure your workflow, agents, usage, sharing and updates.
---

Open **Settings** with the gear at the bottom of the sidebar; its search finds any setting. Use **Save defaults** for model roles; other changes save at once for this computer.

![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-light.webp)
![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-dark.webp)

## Workflow

| Setting | Choices |
| --- | --- |
| **New tasks** | **Engineering** (default) or **Product** ([two levels](../intro.md#two-levels)); change per task until the Plan is approved |
| [Your instructions](#instructions) | Standing instructions for every task |
| [Independent review](#independent-review) | A switch: on (recommended) or off |
| [Second opinion](#second-opinion) | **Off** (default) or **Automatic**, once a second coding agent is installed |
| **Design review** | **Finished designs** (default): a separate agent checks each finished design before you see it. Wireframes are never reviewed |
| [Scan each change](#security-scans) | A switch: on (default) or off |
| [Dependency advisories](#security-scans) | **osv.dev** (default) or **Local copy** |

### Your instructions {#instructions}

Up to 12,000 characters in `~/.qualitylayer/instructions.md`, read by your agent, helpers and reviewers each step and never copied into documents. Lines under `## Plan`, `## Implement`, … apply to that step only, and a `- [ ]` line there is [required](../required-lines.md). [Team instructions](#team-instructions) win on conflict. No line can approve a gate.

### Independent review {#independent-review}

**On**: a separate agent checks each **Done means** point in [Verify](../steps/verify.md). **QualityLayer helpers: This session** keeps review in the lead session, marked as not independent. **Off**: Verify records **Checked without an independent judge**. Default models: Opus 5.5 (Claude Code), GPT-6.1 Sol (Codex, Pi, OpenCode), Opus 5.5 (High) (Cursor), Grok 4.7 (Grok), Claude Opus 4.6 (Antigravity).

### Second opinion {#second-opinion}

**Automatic**: a model from another family reads a risky Plan and a risky built change, read-only, beside your agent. Risky means the Plan says so, the change touches sign-in, secrets or outside input, or a slice is marked risky. QualityLayer picks the reviewer from the agents on this computer: GPT reviews Claude, Claude reviews GPT, and Pi on GPT can review Claude Code's work. Settings shows who checks whose work.

<details>
<summary>How the reviewer is picked</summary>

- Pi and OpenCode count by the model they run; Cursor's Auto never counts as another family.
- Agents that enforce read-only come first, then Claude Code, Codex, Grok, Pi, OpenCode, Cursor, Antigravity, GitHub Copilot. Cursor and Antigravity review a disposable copy.
- When every agent here runs the same family, a fresh session of it reviews. **Reviewed by** in the Plan names who read it.

</details>

### Security scans {#security-scans}

**Scan each change** runs the [security scans](code-health.md#security-scans) in Verify and the secrets scan after each agent turn. **Off**: Verify's Security scans lane says Off; the reviews still run.

**Dependency advisories**: **osv.dev** sends the package names and versions of a changed lockfile to Google's open vulnerability database; your code stays here. **Local copy** downloads that database (about 250 MB for npm and PyPI) the first time a project needs it, and nothing leaves this computer.

## Agents {#defaults}

**On this computer** lists the supported agents with version, sign-in, a check for a ready integration and a **Use** switch. Problems show **Repair**, **Out of date** or **Not installed**. **Models and roles** on the row or in **⋯** opens separate planning, build-lead and helper defaults, plus Claude Code's subagent default. **Install…** opens the vendor's page; QualityLayer never runs an installer. **Show agent sessions as** picks **Conversation** or **Terminal**.

| **⋯ › Edit launch…** | What it changes |
| --- | --- |
| **Command** | The program's absolute path. `QUALITYLAYER_CODEX_BIN`-style variables win over it |
| **Extra arguments** | Added to every start; ones that switch off permission checks are refused |
| **Config folder** | Where the agent keeps its settings |
| **Default effort** | High is recommended; a per-task choice wins |
| **Default permission mode** | Bypass on first use; your saved mode or **Agent settings** wins ([modes](../agents/native.md#permission-modes)) |

Only the App, or a browser paired with its key, can change these.

## Usage {#usage}

**Usage display** shows **Used** percentages by default; choose **Remaining** to change the App and macOS menu bar together. Menu bar usage starts on. Expand **Menu bar readings** to choose individual reported windows and daily dollar readings; quota choices also select the Usage popup's rows. **Daily total** is optional: **API spend ($)** counts metered use; **All usage at API prices ($)** also values subscriptions for comparison. Credits stay separate, and missing data makes totals partial.

**Plan limits** show the windows Claude Code, Codex and GitHub Copilot report. Visible plan readings refresh every five minutes; Codex and Copilot show the latest limits their sources provide. **Resume when a limit resets** (on) continues stopped builds unless someone has typed since. **What your agents used** keeps the daily charts, comparisons and model breakdown for 7 days, 30 days or this month. All eight agents are supported where records provide usage; Cursor needs a local [provider CSV import](commands.md#commands-by-group). The shared money choice also applies to statistics; API-price value is not your bill.

## Sessions {#sessions}

**Running now** lists running agents; **Stop N idle** stops the idle ones, which keep their conversation. Stopping several asks for confirmation.

| Setting | Choices |
| --- | --- |
| **Stop agents that sit idle** | Never, 2 h, 8 h (default) or a day; never one with an open question, approval, turn or helper |
| **Who can type in a session** | **The App and its browsers** (default), or also other paired browsers |
| **When you quit the App** | **Agents keep running** (default) or **Stop agents** |

## Notifications {#notifications}

**Tell me when a task needs me** enables system notifications; **Play a sound with it** adds sound. **Open Feedback automatically** shows incoming questions and replies. Under **Away from this computer**, choose **Slack messages**, **Email messages** and an optional **Morning digest**. Email reaches your seat address once the team owner enables it and Slack doesn't reach you ([Slack and email](../team/plans.md#slack)).

## Git and editor {#git-and-editor}

**Tools** shows whether Git and `gh` are signed in; without `gh`, no pull requests. **Open files and folders in** picks VS Code, Cursor, Zed, Finder or Terminal. **Watch pull requests** (on) wakes the task's agent on a failing check, change request or conflict, at most 3 times a day per pull request and not below 10 % of the plan left.

## Appearance {#appearance}

| Setting | Choices |
| --- | --- |
| **Theme** | System, Light or Dark |
| **Text size** | 90%, 100% (default), 115% or 130% for the installed App window. ⌘+/⌘− resize; ⌘0 resets (Ctrl on Windows/Linux). A browser tab uses its own zoom |
| **Font** | Geist (default), System or Atkinson Hyperlegible. Code, paths and the agent terminal keep their own fonts |
| **Task rows** | Detailed, Two lines or One line |
| **Agent terminal** | **Font size** and **Colours** stay in view; **More terminal settings** holds font, weight, spacing, cursor and scrollback. **Reset to recommended** restores defaults |

## Memory {#memory}

Pause, search or retire lessons, including **Yours**, the lessons about you. **Manage projects** turns Git sharing on per repository ([Project memory](../memory.md)).

## Licence

Your plan or trial, and **Open billing account**. Each licence key works on 3 computers; on Team, every seat has its own key. **On another computer** shows how to move the licence. When all 3 are in use, release one under **Licence keys** in your billing account, run `qualitylayer licence deactivate` on the old computer, or write to hello@qualitylayer.dev.

## Team

| Part | What it holds |
| --- | --- |
| **People and groups** | Seats and members; lists over 10 add name or email search, an **Owner** / **Member** filter and pages of 10. Invited members and **Waiting for the team key** badges stay listed. Groups limit who sees a shared task |
| [Team instructions](#team-instructions) | Instructions for every teammate's agent |
| **Slack** | Workspace connection and your own Slack account; **Slack messages** is in Notifications ([Slack and email](../team/plans.md#slack)) |
| **Email** | Turns email on for the team and shows how each teammate is reached |
| **Shared links** | **Copy** and **Revoke** |

### Team instructions {#team-instructions}

The owner writes them; they reach every teammate's agent before the teammate's own and win on conflict. Teammates read them with **View**. They are encrypted with the team's key and kept locally, so they apply offline. Teammates can't remove their [required lines](../required-lines.md).

## About

The version, **Check now** and **Update channel**: **Stable** (default) or **Beta**, which also moves to each newer stable release ([Updates](../install.md#updates)).

### Server {#server}

**Server port** is 41888 unless you change it (1024 to 65535); type one and **Restart on N**. **In use now** shows the real port, for example "41888 was taken, so it uses 41889." `QUALITYLAYER_PORT` overrides it for one server; `qualitylayer settings set cockpit.port <port>` sets it from the command line.

## For one task {#for-one-task}

Tell your agent "skip security", "run the security review", "get a second opinion" or "no second opinion". No setting turns an approval off.

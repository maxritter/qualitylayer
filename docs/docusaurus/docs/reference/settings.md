---
title: Settings
description: Configure your workflow, agents, usage, sharing and updates.
---

Open **Settings** with the gear at the bottom of the sidebar; its search finds any setting. Changes save at once for this computer.

![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-light.webp)
![Settings: its sections in the sidebar's place, with the task level, your instructions and the reviews in Workflow](pathname:///img/app/settings-dark.webp)

## Workflow

| Setting | Choices |
| --- | --- |
| **New tasks** | **Engineering** (default) or **Product** ([two levels](../intro.md#two-levels)); change per task until the Plan is approved |
| [Your instructions](#instructions) | Standing instructions for every task |
| **Answer questions in** · **Approve in** | **App** or **Your agent**, for tasks you start in an agent; unset until you choose here or your first such task asks ([guide](../work-in-your-agent.md#where)) |
| **Offer QualityLayer** | A switch: on (default), your agent asks once when you ask it to plan without naming QualityLayer |
| [Independent review](#independent-review) | A switch: on (recommended) or off |
| [Second opinion](#second-opinion) | A switch: off (default); it turns on once a second coding agent is installed |
| **Design review** | A switch: on (default), a separate agent checks each finished design before you see it. Wireframes are never reviewed |
| [Scan each change](#security-scans) | A switch: on (default) or off |
| [Dependency advisories](#security-scans) | **osv.dev** (default) or **Local copy** |

### Your instructions {#instructions}

Write up to 12,000 characters in `~/.qualitylayer/instructions.md`. Agents, helpers and reviewers read it each step; documents never copy it. Headings such as `## Plan` and `## Implement` limit lines to that step; checkboxes (`- [ ]`) are [required lines](../required-lines.md). [Team instructions](#team-instructions) win conflicts. Instructions cannot approve a gate.

### Independent review {#independent-review}

**On**: a separate agent checks each **Done means** point in [Verify](../steps/verify.md). **Helpers: This session** in [Models](#models) keeps review in the lead session, marked as not independent. **Off**: Verify records **Checked without an independent judge**. [Models](#models) sets the model each agent reviews on.

### Second opinion {#second-opinion}

**On** adds a read-only review from another model family for risky Plans and changes. Risk includes sign-in, secrets, outside input, or a Plan or slice marked risky. Installed agents provide the reviewers: GPT reviews Claude and Claude reviews GPT; Pi on GPT can review Claude Code. Settings shows the pairing; [Models](#models) sets the model each agent gives its second opinion on.

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

**On this computer** shows each agent's version, sign-in, integration check and **Use** switch. Problems offer **Repair**, **Out of date** or **Not installed**.

- The model button on the row, or **⋯ › Models**, opens [Models](#models) on that agent.
- **Install…** opens the vendor's page; QualityLayer never runs an installer.

| **⋯ › Edit launch…** | What it changes |
| --- | --- |
| **Command** | The program's absolute path. `QUALITYLAYER_CODEX_BIN`-style variables win over it |
| **Extra arguments** | Added to every start; ones that switch off permission checks are refused |
| **Config folder** | Where the agent keeps its settings |
| **Default effort** | High is recommended; a per-task choice wins |
| **Default permission mode** | Bypass on first use; your saved mode or **Agent settings** wins ([modes](../agents/native.md#permission-modes)) |

Only the App, or a browser paired with its key, can change these.

### What setup sets {#what-setup-sets}

Setup adds each of these only when it is missing, next to QualityLayer's own hooks. Your own values stay, and `qualitylayer uninstall` takes back only what it set.

| Agent | Settings |
| --- | --- |
| **Claude Code** permissions | Bypass by default, without its confirmation screen. Existing native and managed policies remain authoritative |
| **Claude Code** git | No attribution in commits or pull requests; no built-in git instructions |
| **Claude Code** display | Concise replies, thinking summaries, reduced motion, flicker-free screen |
| **Claude Code** tools | Task tools, tool search, baseline task reminders, memory consolidation where Claude makes it available, at most 3 Stop-hook continuations in a row, High effort |
| **Codex** | Full access when no permission policy is set, High effort for the session and subagents, the model's largest context window, questions in Terminal mode |
| **Grok** | Questions wait for your answer instead of expiring after 30 minutes |

## Models {#models}

Pick an agent by its mark; every model it uses is on one page. A new task starts with these, and each launch can still pick another model. Each group's **Reset to recommended** puts back only its own rows.

| Group | Rows |
| --- | --- |
| **Plan and build** | **Planning**, **Build · full task**, **Build · small change**, **Build subagents** (Claude Code; other agents decide) and **Helpers**: research, fixes, security checks and Chat work. **This session** keeps that work in the lead |
| **Reviews** | **Independent review**: the model a fresh helper checks each change on when this agent builds. **Second opinion**: the model this agent reviews on when it is picked for another family's work |
| **Model list** | The built-in models, those the agent reports and those you added, with where each is used. **Add a model…** takes an id the agent accepts; **Remove** puts its roles back on the recommended model |

## Usage {#usage}

**Usage display** defaults to **Used**; **Remaining** changes both the App and macOS menu bar. Menu bar usage starts on.

| Control | What it changes |
| --- | --- |
| **Menu bar readings** | Reported quota windows and daily dollars. Quota choices also select the Usage popup's rows |
| **Daily total** | Optional: **API spend ($)** counts metered use; **All usage at API prices ($)** also values subscriptions for comparison |

Credits stay separate in Usage; missing data makes totals partial. The task header’s [Cost](../app.md#cost) uses recorded Copilot AI-credit usage value where available, clearly labelled separately from API-price estimates and money billed.

**Plan limits** shows reported windows for Claude Code, Codex and GitHub Copilot. Visible readings refresh every five minutes; Codex and Copilot depend on their latest source records. **Resume when a limit resets** (on) continues stopped builds unless someone has typed since.

**What your agents used** has daily charts, comparisons and model breakdowns for 7 days, 30 days or this month. All eight agents are supported where records provide usage; Cursor needs a [local CSV import](commands.md#commands-by-group). The same money choice applies to statistics. API-price value is not your bill.

## Sessions {#sessions}

**Running now** lists running agents; **Stop N idle** stops the idle ones, which keep their conversation. Stopping several asks for confirmation.

| Setting | Choices |
| --- | --- |
| **Stop agents that sit idle** | Never, 2 h, 8 h (default) or a day; never one with an open question, approval, turn or helper |
| **Who can type in a session** | **The App and its browsers** (default), or also other paired browsers |
| **When you quit the App** | **Agents keep running** (default) or **Stop agents** |

## Notifications {#notifications}

**Tell me when a task needs me** enables system notifications; **Play a sound with it** adds sound. **Open Feedback automatically** shows incoming questions and replies.

**Away from this computer** controls Slack, email and the morning digest. Email uses your seat address when the team owner enables it and Slack cannot reach you ([routing](../team/plans.md#slack)).

## Git and editor {#git-and-editor}

**Tools** shows whether Git and `gh` are signed in; without `gh`, no pull requests. **Open files and folders in** picks VS Code, Cursor, Zed, Finder or Terminal. **Watch pull requests** (on) wakes the task's agent on a failing check, change request or conflict, at most 3 times a day per pull request, and on people's new review comments up to 2 more times, never below 10 % of the plan left.

## Appearance {#appearance}

| Setting | Choices |
| --- | --- |
| **Theme** | System, Light or Dark |
| **Text size** | 90%, 100% (default), 115% or 130% for the installed App window. ⌘+/⌘− resize; ⌘0 resets (Ctrl on Windows/Linux). A browser tab uses its own zoom |
| **Font** | Geist (default), System or Atkinson Hyperlegible. Code, paths and the agent terminal keep their own fonts |
| **Show agent sessions as** | **Conversation** or **Terminal** for new sessions |
| **Messages while working** | In **Agent controls › Appearance…**: **Steer at next step** (default) or **Queue until the turn ends**; unsupported agents queue without interrupting |
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

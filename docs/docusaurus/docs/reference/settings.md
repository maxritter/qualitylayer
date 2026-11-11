---
title: Settings
description: Configure your workflow, agents, memory, usage and updates.
---

Open **Settings** with the gear at the bottom of the sidebar; its search finds any setting. Changes save at once for this computer.

![Settings: its sections in the sidebar's place, with your instructions, where you answer and approve, and the reviews in Workflow](pathname:///img/app/settings-light.webp)
![Settings: its sections in the sidebar's place, with your instructions, where you answer and approve, and the reviews in Workflow](pathname:///img/app/settings-dark.webp)

## Workflow

| Setting | Choices |
| --- | --- |
| **Offer QualityLayer** | A switch: on (default), your agent asks once when you ask it to plan without naming QualityLayer |
| [Your instructions](#instructions) | Standing instructions for every task |
| **Answer questions in** · **Approve in** | **In the App** (default) or **In my own agent**: your terminal, IDE or agent app, for tasks you start there ([guide](../work-in-your-agent.md#where)) |
| [Independent review](#independent-review) | A switch: on (recommended) or off. Runs in Verify and each recheck |
| **Design review** | A switch: on (default), a separate agent checks each finished design in Plan before you see it. Wireframes are never reviewed |
| [Second opinion](#second-opinion) | A switch: off (default); it turns on once a second coding agent is installed. Runs in Plan and Verify |
| [Scan each change](#security-scans) | A switch: on (default) or off |
| [Dependency advisories](#security-scans) | **osv.dev** (default) or **Local copy** |

Each review row lists the model every installed agent uses for it; click a model to change it in [Models](#models).

### Your instructions {#instructions}

Write up to 12,000 characters in `~/.qualitylayer/instructions.md`. Agents, helpers and reviewers read it each step; documents never copy it. Headings such as `## Plan` and `## Implement` limit lines to that step; a checkbox (`- [ ]`) under one is a [step check](#step-checks). Instructions cannot approve a gate.

#### Step checks {#step-checks}

A step check is a checkbox line under a step's heading. The agent must do it, then record it done or skipped with a reason.

```md
## Verify
- [ ] run: `wizcli dir scan --path .`
- [ ] Review auth changes with the threat-model skill
- Mention Wiz findings in the pull request.
```

| Line | What happens |
| --- | --- |
| `- [ ] run: …` under Implement or Verify | A Project check: the Plan names it, approving the Plan covers running it, and [Verify](../steps/verify.md) records its result |
| `- [ ]` with other words | The agent does it its own way, with a skill, an MCP tool or by hand, and records a note or a reason |
| `-` a plain bullet | Guidance only |

Add one in **Your instructions** › **Steps**, ask your agent (“Add a Wiz scan to Verify's step checks”), or run `qualitylayer instructions add verify "<line>"`. A task keeps the checks it started with; skipped ones stay in its record. Commands use the logins already on your computer.

### Independent review {#independent-review}

**On**: a separate agent checks each **Done means** point in [Verify](../steps/verify.md). **Helpers: This session** in [Models](#models) keeps review in the lead session, marked as not independent. **Off**: Verify shows **Independent review** as **skipped**. [Models](#models) sets the model each agent reviews on.

### Second opinion {#second-opinion}

**On** adds a read-only review by another agent for risky Plans and changes. Risk includes sign-in, secrets, outside input, or a Plan or slice marked risky. The Workflow row shows which agent reviews which. In [Models](#models) you pick, for each agent, the other installed agent that reviews its work and the model it uses. The default is the first agent here from another model family, so GPT reviews Claude and Claude reviews GPT. If the chosen agent is not installed or not signed in, the default reviews instead. Your agent can set it too: `qualitylayer settings set secondOpinion.reviewers.claude-code '{"agent":"codex","model":"gpt-6.1-sol"}'`.

A feature can also take up to two extra planners, each an agent, model and effort, chosen in **New task** or with `qualitylayer task start "<request>" --planners agent:model[:effort],…`. They review its Plan instead of the second opinion, and each is an extra paid planning run.

<details>
<summary>How the default reviewer is picked</summary>

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
| **Reviews** | **Independent review**: the model a fresh helper checks this agent's change on. **Design review**: the model a fresh helper checks this agent's designs on. **Second opinion**: the other installed agent that reads this agent's risky work, and its model. Each works by command too, such as `qualitylayer settings set models.codex.design gpt-6.1-sol` |
| **Model list** | The built-in models, those the agent reports and those you added, with where each is used. **Add a model…** takes an id the agent accepts; **Remove** puts its roles back on the recommended model |

## Usage {#usage}

**Usage display** defaults to **Used**; **Remaining** changes both the App and macOS menu bar. Menu bar usage starts on.

| Control | What it changes |
| --- | --- |
| **Menu bar readings** | Reported quota windows and daily dollars. Quota choices also select the Usage popup's rows |
| **Daily total** | Optional: **API spend ($)** counts metered use; **All usage at API prices ($)** also values subscriptions for comparison |

Credits stay separate in Usage; missing data makes totals partial. The task header’s [Cost](../app.md#cost) uses recorded Copilot AI-credit usage value where available, clearly labelled separately from API-price estimates and money billed.

**Plan limits** shows reported windows for Claude Code, Codex and GitHub Copilot. Visible readings refresh every five minutes; Codex and Copilot depend on their latest source records. **Resume when a limit resets** (on) continues stopped builds unless someone has typed since; **Cancel resume** in the task's agent status stops one.

**Warn about heavy token use** (on) shows one note per task when it passes about 3 times your usual task's tokens (5M before you have three earlier tasks). The task keeps running. Turn it off with `qualitylayer settings set limits.tokenWarning false`.

**What your agents used** has daily charts, comparisons and model breakdowns for 7 days, 30 days or this month. Every supported agent is covered where its records provide usage; Cursor needs a [local CSV import](commands.md#commands-by-group). The same money choice applies to statistics. API-price value is not your bill.

## Sessions {#sessions}

**Running now** lists running agents; **Stop N idle** stops the idle ones, which keep their conversation. Stopping several asks for confirmation.

| Setting | Choices |
| --- | --- |
| **Stop agents that sit idle** | Never, 2 h, 8 h (default) or a day; never one with an open question, approval, turn or helper |
| **Who can type in a session** | **The App and its browsers** (default), or also other paired browsers |
| **When you quit the App** | **Agents keep running** (default) or **Stop agents** |

## Machines {#machines}

Work on another Linux or macOS computer you reach over ssh, from this App ([setup guide](../machines.md)). **Add machine** picks a host from your ssh config or takes `user@host`, checks it, and after one confirmation installs QualityLayer there and activates your licence key on it. The sidebar's head then switches between **This computer** and each machine, with a count of what waits for you elsewhere.

A machine keeps working while this computer sleeps and reconnects by itself. **ssh needs you** means ssh wants a key or a host confirmation: run the `ssh` command the row shows once in a terminal, then **Try again**. **Remove…** only drops the connection; tick the box to release the machine's licence activation too. Windows machines keep their own App.

## Notifications {#notifications}

**Tell me when a task needs me** enables system notifications; **Play a sound with it** adds sound.

Use your own connected machine or paired browser to return to your work away from this computer.

## Git and editor {#git-and-editor}

**Tools** shows whether Git and `gh` are signed in; without `gh`, no pull requests. **Open files and folders in** picks VS Code, Cursor, Zed, Finder or Terminal. **Watch pull requests** (on) wakes the task's agent on a failing check, change request or conflict, at most 3 times a day per pull request, and on people's new review comments up to 2 more times, never below 10 % of the plan left.

## Automations {#automations}

Send task events to a URL or a command. A browser that may only watch cannot change them. See [Automations](../automations.md).

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

Pause, search or retire lessons, including **Yours**, the lessons about you. **Manage projects** controls optional Git export per repository ([Project memory](../memory.md)).

## Licence

Your plan or trial, and **Open billing account**. To use a key you bought, choose **Enter key…** (during the trial too) and paste it from your billing account; Setup offers the same field. From a terminal, run `qualitylayer licence activate <key>`; on Windows before the command is set up, run `& "$env:LOCALAPPDATA\QualityLayer\qualitylayer-cli.exe" licence activate <key>` in PowerShell. Each licence key works on 5 computers, [machines](#machines) included; on Business, every assigned seat has its own key. **On another computer** shows how to move the licence. When all 5 are in use, release one under **Licence keys** in your billing account, run `qualitylayer licence deactivate` on the old computer, or write to hello@qualitylayer.dev.


## About

The version, **Check now** and **Update channel**: **Stable** (default) or **Beta**, which also moves to each newer stable release ([Updates](../install.md#updates)).

### Server {#server}

**Server port** is 41888 unless you change it (1024 to 65535); type one and **Restart on N**. **In use now** shows the real port, for example "41888 was taken, so it uses 41889." `QUALITYLAYER_PORT` overrides it for one server; `qualitylayer settings set cockpit.port <port>` sets it from the command line.

## For one task {#for-one-task}

Tell your agent "skip security", "run the security review", "get a second opinion" or "no second opinion". No setting turns an approval off.

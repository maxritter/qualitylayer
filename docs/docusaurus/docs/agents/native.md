---
title: Supported agents
sidebar_label: Supported agents
description: Set up supported coding agents and choose their models, permissions and reviewers.
---

# Supported agents {#supported-agents}

Install your agent, sign in and start it once, then run QualityLayer setup. It connects every supported agent it finds.

| Agent | Checked with | What QualityLayer adds |
| --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/setup) | 2.1.306 | Skills, lifecycle hooks and its existing prompt integration |
| [Codex](https://developers.openai.com/codex/cli) | 0.163.0 | Skills, implicit invocation policies and lifecycle hooks |
| [Cursor](https://cursor.com/docs/cli/installation) | 2026.10.19 | Skills and turn-end hooks in its own hooks file |
| [Grok](https://docs.x.ai/build/overview) | 1.0.62 | Skills and hooks, in its own hooks folder |
| [Antigravity](https://antigravity.google/docs/getting-started/) | 1.4.12 | Skills, a workflow command and turn-end hooks |
| [Pi](https://pi.dev/docs/latest/quickstart) | 1.2.0 | Skills, a lifecycle extension and fresh helper sessions |
| [OpenCode](https://opencode.ai/docs/) | 2.0.29 | Skills, a command and a lifecycle plugin |
| [GitHub Copilot](https://docs.github.com/copilot/how-tos/copilot-cli) | 1.0.105 | Skills, a hook file and the memory server |

Cursor, Grok and Antigravity are set up only after you have started them once from a terminal. GitHub Copilot Business and Enterprise need an organization admin to enable Copilot CLI in the Copilot policies.
Start a task with **+ › Task** in the App, or tell your agent “Using QualityLayer, plan a CSV export” (**QL** works too, in any language). An ordinary coding request does not start a workflow.

## The six skills

Ask in plain language; your agent picks the skill.

| Skill | What it does |
| --- | --- |
| `ql-workflow` | Plan, build, verify and review a change. The only skill that starts a task |
| `ql-artifact` | Mockups, diagrams and clickable pages ([Artifacts](../artifacts.md)) |
| `ql-manage` | Tasks, [memory](../memory.md), sharing, settings and setup |
| `ql-peer` | Let sessions of any of these agents review each other or hand over a task ([session messaging](../reference/commands.md#session-messaging)) |
| `ql-quality` | Code complexity, structure and duplication ([Code health](../reference/code-health.md)) |
| `ql-chat` | A [Chat](../chat.md) without workflow steps |

## Models and reviews

Pick agent, model and effort per task; the default effort is High.

| Agent | Model choices |
| --- | --- |
| Pi / OpenCode | Provider-qualified IDs: `openai-codex/gpt-6.1-sol` / `openai/gpt-6.1-sol`; both can use a Copilot subscription |
| Cursor / Antigravity | Effort is part of the model name, such as Opus 5.5 (High) |
| GitHub Copilot | Auto works on every plan; paid plans can choose Claude Opus 5.5 |

Reviewers use a separate context and edit nothing. Cursor and Antigravity review disposable copies and stop at the first non-read-only tool. [Reviewer selection](../reference/settings.md#second-opinion).

## Sessions in the App

The **Conversation** view reads each agent's session record ([controls](../app.md#agent-runs)). Some records hold less:

| Agent | What its Conversation lacks |
| --- | --- |
| Claude Code, Codex, Pi, OpenCode | Nothing |
| Grok | Context fill, permission questions |
| Antigravity | Permission questions |
| Cursor | Thinking, tool output, token counts, context fill, permission questions |
| GitHub Copilot | Permission questions |

Permission waits show in Conversation. For Terminal-only replies, the App opens Terminal and offers **Open Terminal**. Cursor receives numbered workflow questions; the others ask in their own picker ([Work only in your agent](../work-in-your-agent.md#pickers)). After a crash, stop the old run and ask “Using QL, continue verification of task retry-webhooks.”

### Permission modes {#permission-modes}

New managed sessions default to Bypass. Your saved global or per-agent mode takes precedence; **Agent settings** explicitly inherits the native policy. Planning remembers your last successful choices, and Build inherits this task’s planning choices, including accepted native permission changes.

| Agent | Modes |
| --- | --- |
| Claude Code | Auto, Ask first, Accept edits, Bypass |
| Codex | On request, Ask first, Auto review, Full access |
| Cursor | Ask first, Auto-review, Run everything |
| Grok | Auto, Ask first, Accept edits, Bypass |
| Antigravity | Ask first, Auto, Accept edits, Bypass |
| OpenCode | Agent settings, Auto-approve |
| Pi | None; its own tool permissions apply |
| GitHub Copilot | Manual Approval, Assisted Permissions, Allow All |

Switching an existing session to Bypass, Full access or Run everything needs confirmation. **Apply and continue** can change permissions at a supported native prompt and resume that conversation. Older Copilot sessions use Terminal's `/permissions` menu. Pi has no native bypass switch; OpenCode keeps explicit denials. Plan and final approvals remain separate.

### Plan limits {#plan-limits}

**Claude Code**, **Codex** and **GitHub Copilot** show the windows their records report. Percentages default to **Used**, such as **Week · 58 % used**; [Usage display](../reference/settings.md#usage) switches the App and macOS menu bar to **Remaining**. Claude Code uses its `/usage` report, Codex its session/account records, and Copilot its monthly allowance snapshots. Missing or reset readings stay unknown. Agents billed by use show the session's estimated cost instead.

## How QualityLayer finds your agents {#finding-agents}

**Not installed** means it was not found. Enter the full path in **⋯ › Edit launch…** › **Command**, for example `/opt/tools/bin/codex`, or press **Check again**.

<details>
<summary>Search order</summary>

1. The **Command** you set. If it cannot run, the agent counts as missing.
2. The App's PATH, then your login shell's PATH.
3. `~/.local/bin`, `~/.codex/packages/standalone/current/bin`, Homebrew, `~/.npm-global/bin`, Bun, Volta, pnpm, nvm and fnm.
4. npm's global folder.
5. For Codex, the command inside the ChatGPT or Codex desktop app.

`--version` must name the agent, such as `codex-cli 0.163.0`.

</details>

## Setup and removal

`qualitylayer agents list` and `qualitylayer agents check` match Settings › Agents. Pi's files go to `~/.pi/agent`, OpenCode's to `~/.config/opencode`, GitHub Copilot's to `~/.copilot`. Updates replace only unchanged files QualityLayer owns; uninstall keeps your logins, settings, session history and edited files. [Other agents](other.md) use the CLI.

---
title: Supported agents
sidebar_label: Supported agents
description: Set up the seven coding agents QualityLayer runs, choose their models, permission modes and reviewers, and control their sessions in the App.
---

# Supported agents {#supported-agents}

Install your agent, sign in with its own login and start it once, then run QualityLayer setup. The installers add the integration for every agent they find.

| Agent | Checked with | What QualityLayer adds |
| --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/setup) | 2.1.306 | Skills, lifecycle hooks and its existing prompt integration |
| [Codex](https://developers.openai.com/codex/cli) | 0.163.0 | Skills, implicit invocation policies and lifecycle hooks |
| [Cursor](https://cursor.com/docs/cli/installation) | 2026.10.19 | Skills and turn-end hooks in its own hooks file |
| [Grok](https://docs.x.ai/build/overview) | 1.0.62 | Skills and hooks, in its own hooks folder |
| [Antigravity](https://antigravity.google/docs/getting-started/) | 1.4.4 | Skills, a workflow command and turn-end hooks |
| [Pi](https://pi.dev/docs/latest/quickstart) | 1.2.0 | Skills, a lifecycle extension and fresh helper sessions |
| [OpenCode](https://opencode.ai/docs/) | 2.0.29 | Skills, a command and a lifecycle plugin |

Cursor, Grok and Antigravity are set up only after you have started them once from a terminal.

Start a task with **+ New** in the App, or tell your agent “Using QualityLayer, plan a CSV export” (**QL** works too, in any language). An ordinary coding request does not start a workflow.

## The six skills

Ask in plain language; your agent picks the skill.

| Skill | What it does |
| --- | --- |
| `ql-workflow` | Plan, build, verify and review a change. The only skill that starts a task |
| `ql-artifact` | Mockups, diagrams and clickable pages ([Artifacts](../artifacts.md)) |
| `ql-manage` | Tasks, [memory](../memory.md), sharing, settings and setup |
| `ql-peer` | Let Claude Code, Codex, Pi and OpenCode sessions review each other or hand over a task ([session messaging](../reference/commands.md#session-messaging)) |
| `ql-quality` | Code complexity, structure and duplication ([Code health](../reference/code-health.md)) |
| `ql-chat` | A [Chat](../chat.md) without workflow steps |

## Models and reviews

Pick agent, model and effort per task; defaults use High effort. Pi and OpenCode use provider-qualified IDs, such as `openai-codex/gpt-6.1-sol` (Pi) and `openai/gpt-6.1-sol` (OpenCode). Cursor puts effort in the model name, such as Opus 5.5 (High).

Reviewers read in a separate context and edit nothing. Cursor and Antigravity cannot be made read-only, so they review a disposable copy and are stopped at the first tool that is not read-only. Who reviews: [Second opinion](../reference/settings.md#second-opinion).

## Sessions in the App

The **Conversation** view reads each agent's session record ([controls](../app.md#agent-runs)). Some records hold less:

| Agent | What its Conversation lacks |
| --- | --- |
| Claude Code, Codex, Pi, OpenCode | Nothing |
| Grok | Context fill, permission questions |
| Antigravity | Permission questions |
| Cursor | Thinking, tool output, token counts, context fill, permission questions |

Missing permission questions appear in the Terminal view. Cursor, Grok and Antigravity get workflow questions as a numbered list. To continue after a crash, stop the old run and say “Using QL, continue verification of task retry-webhooks.”

### Permission modes {#permission-modes}

A run starts in your agent's own setting; the row under the message box shows its source and switches modes.

| Agent | Modes |
| --- | --- |
| Claude Code | Auto, Ask first, Accept edits, Bypass |
| Codex | On request, Ask first, Auto review, Full access |
| Cursor | Ask first, Auto-review, Run everything |
| Grok | Auto, Ask first, Accept edits, Bypass |
| Antigravity | Ask first, Accept edits, Auto, Bypass |
| OpenCode | Agent settings, Auto-approve |
| Pi | None; its own tool permissions apply |

Bypass, Full access and Run everything skip every check: they ask you to confirm each time and cannot be a default.

### Plan limits {#plan-limits}

For **Claude Code** and **Codex**, QualityLayer shows what is left of each plan window, in the sidebar and as a chip such as **Week · 42 % left** (amber when you use it faster than an even pace). Claude Code's numbers come from its own `/usage` report, Codex's from its session records; your settings are never changed to read them. Agents billed by use show the session's cost at list prices instead.

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

`qualitylayer agents list` and `qualitylayer agents check` match Settings › Agents. Pi's files go to `~/.pi/agent`, OpenCode's to `~/.config/opencode`. Updates replace only unchanged files QualityLayer owns; uninstall keeps your logins, settings, session history and edited files. [Other agents](other.md) use the CLI.

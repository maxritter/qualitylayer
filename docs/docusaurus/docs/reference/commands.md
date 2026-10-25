---
title: Commands
description: Ask in plain language, or look up the CLI commands for tasks, artifacts, code health and memory.
---

`qualitylayer help` lists every command your installed version has. Add `--json` for machine-readable output, or `--task <slug>` when several tasks are open. `ql` is the short name for the same command.

## In your agent

Ask your agent in plain language and name **QualityLayer** or **QL**. The same wording works in Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode.

| Example request | What it does |
| --- | --- |
| “Using QualityLayer, plan a CSV export” | Starts a task with [Discuss](../steps/discuss.md); Research and the Plan follow in the same session |
| “Using QL, implement the approved plan for task retry-webhooks” | Builds an approved Plan ([Implement](../steps/implement.md#start-implement)) |
| “Using QL, review task retry-webhooks” | Works through review threads: your team's ([Change reviews](../team/changes.md)) or the pull request's ([Pull request](../steps/pull-request.md)) |
| “Using QL, answer the team ask a1” | Answers a teammate's question ([Teammates' agents](../team/agents.md)) |
| “Open the current QualityLayer artifact in my browser at Billing” | Opens that artifact page and section |

**+ New** and **Start the build** offer **In the App** and **In my terminal**; see [App runs](../app.md#agent-runs). Your agent picks the right skill itself: `ql-workflow` for tasks, `ql-chat` for Chat, `ql-artifact` for artifacts, `ql-peer` for other sessions and `ql-manage` for lookup, memory, sharing and setup.

## Chat {#chat}

Ask Claude Code or Codex: “Using QualityLayer, chat about retrying failed webhooks.” Chat has no approvals to pass. Its tools run when you ask for them; see the [Chat guide](../chat.md).

| Command | What it does |
| --- | --- |
| `chat plan save --file <markdown>` | Save a plan as `chat-plan.md` (`--text` instead of a file) |
| `chat build [--file <outline>]` · `--stop <slice>` | Start or resume slice helpers, or record one stopped |
| `chat check [--slice <n>]` · `chat review` | Print the validation commands, or brief a fresh reviewer |
| `chat promote --type feature\|bugfix` | Turn the Chat into a task at Discuss, keeping its context |

## Terminal mode

Ask “Using QualityLayer in the terminal, plan a CSV export” to answer questions and approve in your agent's chat instead of the App. Only your own picks or words count as answers and approvals.

| Command | What it does |
| --- | --- |
| `task set answers=terminal\|app` | Change where you answer for the current task |
| `settings set answers terminal` | The default for tasks started without a location |
| `read 03-plan.md [--lead]` · `read artifact <name>` | Read a document or an artifact page as terminal text |

## Commands by group

Every command starts with `qualitylayer`, as in `qualitylayer gate open 03-plan.md`. Your agent runs the workflow commands; you rarely type them.

| Group | Commands | What they are for |
| --- | --- | --- |
| Workflow | `next` · `next --implement` · `next done` · `gate open 03-plan.md` · `gate open final` · `plan draft` · `plan amend` | Move a task through its steps, open an approval, and record a change to the approved Plan with its reason |
| Questions | `question ask` · `question show` · `question answered` · `question link` · `wait` | Ask you in the App or the chat, record your answers and wait for them |
| Building | `check task T<n>\|slice <n>\|all` · `commit slice <n>\|slices\|fix` · `card T<n>` · `need "<what. why>" --for T<n>` · `limit add` · `progress` | Run and record the approved checks, commit only this task's files, and say what only you can unblock |
| Checking | `verdict` · `verdict run` · `attest` · `evidence shot` · `validate` | A fresh reviewer records its results; your confirmations are recorded in your words |
| Review | `comments list\|take\|resolve` · `review fix-open-items` · `pr watch` | Answer comments, fix what stayed open, follow the pull request's checks |
| Tasks | `find` · `tasks` · `task set` · `task override` · `task archive\|restore` · `branch new` | Find and adjust tasks |
| App | `app` · `app status` · `app restart` · `agents list\|check\|repair` | Open the App, check its server and the installed agents |
| Setup | `doctor [--repair]` · `settings get\|set` · `update` · `uninstall` · `reset --first-start` · `licence status\|activate\|deactivate\|portal` · `feedback` | Check, configure, update and remove QualityLayer |

## Read a public share

```sh
qualitylayer share fetch --link-file /path/to/private-link.txt --out ./shared-copies --json
```

Reading the link from a file (or `--link-stdin`) keeps it out of your shell history. No licence is needed, and fetching approves, publishes and changes nothing. The key after `#` decrypts the copy on your computer and is never sent; each fetch writes a new private folder at that revision, and revoking a link cannot remove files already downloaded.

## Artifacts {#artifacts}

Ask your agent to create, open or revise an artifact; [the visual guide](../artifacts.md) explains the workspace.

| Command | What it does |
| --- | --- |
| `artifact new <name> [--wire] [--folder] [--on <artifact>]` | Start an artifact, a wireframe, a multi-page folder, or a draft on a lasting artifact |
| `artifact show\|open <name> [--page <page>] [--section <id>] [--browser]` | Show the latest version, or open an exact page |
| `artifact keep <name> [--only-here]` | Make a draft a lasting artifact of the project |
| `artifact list` · `artifact comments <name> [resolve <id…\|all>]` | List artifacts, read and resolve comments |
| `artifact check\|shot <name> [--page <page>]` · `artifact review <name>` | Check the HTML, take pictures, or brief a fresh design check |
| `artifact tokens <name> [--refresh]` | Find and fix values that differ from the project's design file |
| `artifact library inspect\|rename\|copy\|archive\|restore\|delete <name>` | Manage the project's lasting artifacts |
| `artifact shared list\|versions\|restore\|pull\|save` | Work with artifacts your team shares ([Shared artifacts](../artifacts.md#team-shared)) |

Changing commands take `--if-match <revision>` from `artifact inspect` or `artifact library inspect`, so a stale copy is refused. `artifact shot` and `check --render` need Chrome.

## Code health {#code-health}

Local Qlty checks are advisory; see [Code health](code-health.md).

| Command | What it does |
| --- | --- |
| `quality check [paths...] [--all] [--duplication] [--fail-on-new]` | Check changed or named source; with no paths, changed and untracked files |
| `quality metrics\|lint [paths...]` | Function metrics, or the project's enabled linters |
| `quality acknowledge <id> --reason "<evidence>"` | Keep a finding you reviewed, with its reason; changed source needs review again |
| `quality status\|setup\|on\|off` | Check or repair the setup, pause or resume checks in this project |

## Project memory {#memory}

The App and your agents share one local lesson store; see [Project memory](../memory.md). Lessons sent to a cloud agent may reach its provider.

| Command | What it does |
| --- | --- |
| `memory overview\|list\|search <text>\|read <id>` | Browse and read lessons; `list --sources changed` lists those whose files changed since they were checked |
| `memory store --title <text> --content <text>` | Save a lesson; `--file <path>` (repeatable) names its files, `--rests-on <text>` the decision it rests on, `--replaces <id>` retires the one it updates |
| `memory confirm\|retire <id> [--reason <text>]` | Record that a lesson still holds at the current commit, or retire it with the reason |
| `memory pin\|unpin\|restore <id>` | Keep a lesson in every session, or restore a retired one |
| `memory pause\|resume` · `memory sessions on\|off` | Pause capture, or the lessons sessions receive at start |
| `memory share on\|off` · `memory sync\|export\|import` | Share lessons through tracked repository files, without commits or pushes |
| `memory mcp` · `memory import-pilot <file>…` | Serve the lesson tools over MCP, or import Pilot records |

## Session messaging

Claude Code, Codex, Pi and OpenCode sessions on your computer can message each other; your agents use `ql-peer` for it.

```bash
qualitylayer peers list
qualitylayer peers send --to 'cc:<name-or-uuid>' --message-file ./review-request.txt --json
```

Address a session with `cc:`, `codex:`, `pi:` or `opencode:` and its name or UUID from `peers list`. `peers inbox`, `peers dispatch`, `peers await` and `peers reply` handle requests that expect an answer; `peers help` lists them. A session is missing? Run `qualitylayer peers doctor`.

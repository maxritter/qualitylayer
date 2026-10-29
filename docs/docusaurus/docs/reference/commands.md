---
title: Commands
description: Ask in plain language, or look up the CLI commands for tasks, artifacts, code health and memory.
---

`qualitylayer help` lists every command in your version (`ql` for short). Add `--json` for machine-readable output, or `--task <slug>` when several tasks are open.

## In your agent

Name **QualityLayer** or **QL** in a plain request; your agent picks the [skill](../agents/native.md#the-six-skills).

| Example request | What it does |
| --- | --- |
| “Using QualityLayer, plan a CSV export” | Starts a task at [Discuss](../steps/discuss.md) |
| “Using QL, implement the approved plan for task retry-webhooks” | Builds an approved Plan ([Implement](../steps/implement.md#start-implement)) |
| “Using QL, review task retry-webhooks” | Works through [team](../team/changes.md) or [pull request](../steps/pull-request.md) review threads |
| “Using QL, answer the team ask a1” | Answers a teammate's question ([Teammates' agents](../team/agents.md)) |
| “Open the current QualityLayer artifact in my browser at Billing” | Opens that artifact page and section |

## Existing plans {#existing-plans}

`qualitylayer next --from-plan ./plan.md` (or `-` for standard input) starts at Plan from a Markdown or plain-text plan, kept unchanged ([Plan](../steps/plan.md#existing-plan)).

## Chat {#chat}

“Using QualityLayer, chat about retrying failed webhooks” starts a [Chat](../chat.md) in Claude Code or Codex.

| Command | What it does |
| --- | --- |
| `chat plan save --file <markdown>` | Save `chat-plan.md` (`--text` instead of a file) |
| `chat build [--file <outline>]` · `--stop <slice>` | Start or resume slice helpers, or record one stopped |
| `chat check [--slice <n>]` · `chat review` | Print validation commands, or brief a fresh reviewer |
| `chat promote --type feature\|bugfix [--from-saved-plan]` | Move into the workflow at Discuss, or at Plan from the saved plan |

## Terminal mode

“Using QualityLayer in the terminal, plan a CSV export” keeps questions and approvals in your agent's chat. Only your own picks or words count.

| Command | What it does |
| --- | --- |
| `task set answers=terminal\|app` | Where you answer for the current task |
| `settings set answers terminal` | The default for new tasks |
| `read 03-plan.md [--lead]` · `read artifact <name>` | Read a document or artifact page as text |

## Commands by group

Every command starts with `qualitylayer`, as in `qualitylayer gate open 03-plan.md`. Your agent runs the workflow commands.

| Group | Commands |
| --- | --- |
| Workflow | `next` · `next --implement` · `next done` · `gate open 03-plan.md` · `gate open final` · `plan draft` · `plan amend` |
| Questions | `question ask` · `question show` · `question answered` · `question link` · `wait` |
| Building | `check task T<n>\|slice <n>\|all` · `commit slice <n>\|slices\|fix` · `card T<n>` · `need "<what. why>" --for T<n>` · `limit add` · `progress` |
| Checking | `verdict` · `verdict run` · `attest` · `evidence shot` · `validate` |
| Review | `comments list\|take\|resolve` · `review fix-open-items` · `pr watch` |
| Tasks | `find` · `tasks` · `task set` · `task override` · `task archive\|restore` · `branch new` |
| App | `app` · `app status` · `app restart` · `agents list\|check\|repair` |
| Setup | `doctor [--repair]` · `settings get\|set` · `update` · `uninstall` · `reset --first-start` · `licence status\|activate\|deactivate\|portal` · `feedback` |

## Read a public share

```sh
qualitylayer share fetch --link-file /path/to/private-link.txt --out ./shared-copies --json
```

A link file (or `--link-stdin`) keeps the link out of your shell history. No licence is needed, and fetching changes nothing. The key after `#` decrypts on your computer and is never sent. Revoking a link cannot remove copies already downloaded.

## Artifacts {#artifacts}

| Command | What it does |
| --- | --- |
| `artifact new <name> [--wire] [--folder] [--on <artifact>]` | Start an artifact, wireframe, multi-page folder, or draft on a lasting artifact |
| `artifact show\|open <name> [--page <page>] [--section <id>] [--browser]` | Show the latest version, or open an exact page |
| `artifact keep <name> [--only-here]` | Make a draft a lasting artifact |
| `artifact list` · `artifact comments <name> [resolve <id…\|all>]` | List artifacts; read and resolve comments |
| `artifact check\|shot <name> [--page <page>]` · `artifact review <name>` | Check the HTML, take pictures, or brief a design check |
| `artifact tokens <name> [--refresh]` | Fix values that differ from the project's design file |
| `artifact library inspect\|rename\|copy\|archive\|restore\|delete <name>` | Manage lasting artifacts |
| `artifact shared list\|versions\|restore\|pull\|save` | Team-shared artifacts ([Shared artifacts](../artifacts.md#team-shared)) |
| `artifact link list` · `artifact link revoke <record-id>` | List saved outside links or revoke one, even after its source artifact is removed |

Artifact edits take `--if-match <revision>` from `artifact inspect` or `artifact library inspect`. `artifact shot` and `check --render` need Chrome.

## Code health and security scans {#code-health}

Advisory local checks ([Code health and security scans](code-health.md)).

| Command | What it does |
| --- | --- |
| `quality check [paths...] [--all] [--duplication] [--fail-on-new]` | Check changed and untracked, or named, source |
| `quality scan [paths... \| --since <rev>] [--secrets\|--dependencies\|--workflows\|--code] [--local]` | Scan changed or named files for secrets, vulnerable packages, unsafe workflows and risky code |
| `quality metrics\|lint [paths...]` | Function metrics, or the project's linters |
| `quality acknowledge <id> --reason "<evidence>"` | Keep a reviewed finding with its reason |
| `quality status\|setup\|on\|off` | Check, repair (also reinstalls the scanners), pause or resume |

## Project memory {#memory}

One local lesson store for the App and your agents ([Project memory](../memory.md)).

| Command | What it does |
| --- | --- |
| `memory overview\|list\|search <text>\|read <id>` | Browse lessons; `list --sources changed` shows those whose files changed |
| `memory store --title <text> --content <text>` | Save a lesson; `--file`, `--rests-on` and `--replaces <id>` add context |
| `memory confirm\|retire <id> [--reason <text>]` | Confirm a lesson at the current commit, or retire it |
| `memory pin\|unpin\|restore <id>` | Keep a lesson in every session, or restore a retired one |
| `memory pause\|resume` · `memory sessions on\|off` | Pause capture, or session lessons |
| `memory share on\|off` · `memory sync\|export\|import` | Share lessons through repository files, never committing or pushing |
| `memory mcp` · `memory import-pilot <file>…` | Serve lesson tools over MCP, or import Pilot records |

## Session messaging

Claude Code, Codex, Pi and OpenCode sessions on your computer can message each other (`ql-peer`).

```bash
qualitylayer peers list
qualitylayer peers send --to 'cc:<name-or-uuid>' --message-file ./review-request.txt --json
```

Address `cc:`, `codex:`, `pi:` or `opencode:` plus a name or UUID. `peers help` lists the reply commands; `peers doctor` finds a missing session.

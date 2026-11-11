---
title: Commands
description: Ask in plain language, or look up the CLI commands for tasks, artifacts, code health and memory.
---

Use `qualitylayer help` (`ql` for short) to list commands. Add `--json` for machine-readable output and `--task <slug>` to select an open task.

## In your agent

Name **QualityLayer** or **QL** in a plain request; your agent picks the [skill](../agents/native.md#the-six-skills).

| Example request | What it does |
| --- | --- |
| “Using QualityLayer, plan a CSV export” | Starts a task at [Plan](../steps/plan.md) |
| “Using QL, implement the approved plan for task retry-webhooks” | Builds an approved Plan ([Implement](../steps/implement.md#start-implement)) |
| “Using QL, review task retry-webhooks” | Reviews the result or follows [pull request](../steps/pull-request.md) review threads |
| “Open the current QualityLayer artifact in my browser at Billing” | Opens that artifact page and section |

## Existing plans {#existing-plans}

`qualitylayer task start "<request>" --from-plan ./plan.md` starts at Plan from an existing Markdown or plain-text plan. Use `-` for standard input. The original stays unchanged ([Plan](../steps/plan.md#existing-plan)).

## Chat {#chat}

“Using QualityLayer, chat about retrying failed webhooks” starts a [Chat](../chat.md) with a supported coding agent.

| Command | What it does |
| --- | --- |
| `chat plan save --file <markdown>` | Save `chat-plan.md` (`--text` instead of a file) |
| `chat build [--file <outline>]` · `--stop <slice>` | Start or resume slice helpers, or record one stopped |
| `chat check [--slice <n>]` · `chat review` | Print validation commands, or brief a fresh reviewer |
| `chat promote --type feature\|bugfix [--from-saved-plan]` | Move into the workflow at Plan, from the conversation or the saved plan |

## Terminal mode

“Using QualityLayer in the terminal, plan a CSV export” keeps questions and approvals in your agent's chat. Only your own picks or words count ([Work only in your agent](../work-in-your-agent.md)).

| Command | What it does |
| --- | --- |
| `task set answers=terminal\|app` · `approvals=terminal\|app` | Where you answer and approve for the current task |
| `settings set answers terminal` · `settings set approvals terminal` | Where tasks you start in your agent answer and approve |
| `settings set offerWorkflow false` | Your agent no longer offers QualityLayer when you ask it to plan |
| `read 01-plan.md [--lead]` · `read artifact <name>` | Read a document or artifact page as text |
| `plan export --out <folder>` | Export the Plan, its agents' file and pictures; report any picture that could not be made |

## Commands by group

Prefix each command with `qualitylayer`, for example `qualitylayer gate open plan`.

| Group | Commands |
| --- | --- |
| [Required lines](../required-lines.md) | `instructions` · `instructions add <step> "<line>"` · `instructions done\|skip <step> <n>` |
| [Automations](../automations.md) | `automations list` · `automations add --url <url> \| --command "<command>"` · `automations set\|remove\|test\|log\|secret <id>` · `automations events` |
| Tasks | `find` · `tasks` · `status` · `task set` · `task start` · `task override` · `task archive\|restore` · `branch new` |
| App | `app` · `app status` · `app restart` · `agents list\|check\|repair` |
| Setup | `doctor [--repair]` · `settings get\|set` · `update` · `uninstall [--purge | --keep-data]` · `reset --first-start` · `licence status\|activate\|deactivate\|portal` · `feedback` |
| Usage | `usage import cursor <file.csv> --from <ISO time> --to <ISO time> [--account <local label>]` — import a local CSV; reimport to include later usage |

<details>
<summary>Workflow commands your agent runs</summary>

| Group | Commands |
| --- | --- |
| Workflow | `next` (reads only) · `brief plan\|implement\|verify` · `task start` · `plan draft` · `gate open plan\|final` · `plan amend` · `plan export` · `wait` |
| Questions | `question ask` · `question show` · `question answered` · `question link` |
| Building | `build start` · `build done` · `check task T<n>\|slice <n>\|step A<n>\|all` · `commit slice <n>\|slices\|fix [--commit <hash>]` · `card T<n>` · `need "<what. why>" --for T<n>` · `limit add` · `progress` |
| Checking | `verify judge\|recheck\|fix\|keep-red` · `verdict` · `verdict run` · `attest` · `evidence shot` · `validate` |
| Shipping | `ship` · `pr watch` |

</details>

## Artifacts {#artifacts}

| Command | What it does |
| --- | --- |
| `artifact new <name> [--wire] [--folder] [--on <artifact>]` | Start an artifact, wireframe, multi-page folder, or draft on a lasting artifact |
| `artifact show\|open <name> [--page <page>] [--section <id>] [--browser]` | Show the latest version, or open an exact page |
| `artifact keep <name> [--only-here]` | Make a draft a lasting artifact |
| `artifact list` | List local artifacts |
| `artifact check\|shot <name> [--page <page>]` · `artifact review <name>` | Check the HTML, take pictures, or brief a design check |
| `artifact tokens <name> [--refresh]` | Fix values that differ from the project's design file |
| `artifact library inspect\|rename\|copy\|archive\|restore\|delete <name>` | Manage lasting artifacts |

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
| `memory overview\|list\|search <text>\|read <id>` | Browse lessons; `--scope repo\|you` picks this project or yours. `list --sources changed` shows lessons whose files changed |
| `memory store --title <text> --content <text>` | Save a lesson; `--file`, `--rests-on` and `--replaces <id>` add context. `--about you` saves a personal lesson for every repository |
| `memory confirm\|retire <id> [--reason <text>]` | Confirm a lesson at the current commit, or retire it. Personal lessons have no commit to confirm against |
| `memory pin\|unpin\|restore <id>` | Keep a lesson in every session, or restore a retired one |
| `memory pause\|resume` · `memory sessions on\|off` | Pause capture, or session lessons |
| `memory share on\|off` · `memory export` | Opt into project Git export, or write eligible records; never commits, pushes or pulls |
| `memory import` | Explicitly import repository records; differs from restoring a retired local lesson |
| `memory conflicts` · `memory reconcile <id> --revision <n> --candidate local\|<fingerprint>` | Inspect conflicting revisions and explicitly reconcile them |
| `memory mcp` · `memory import-pilot <file>…` | Serve lesson tools over MCP, or import Pilot records |

## Session messaging

To oversee a task, ask your agent to run `qualitylayer status --json --task <task>` from its checkout. Read the task documents for verification evidence.

| Status field | What it reports |
| --- | --- |
| `waiting_on` | A human action, agent or helper work, or unknown activity. Native permission requests use `reason: agent_permission` |
| `last_decision` | Approvals and requested changes |
| `answer_mode` | Where you answer, with its recorded origin |

Sessions on this computer coordinate through `ql-peer` within the work you authorize. You choose the build session and approve the Plan and the finished change.

```bash
qualitylayer peers list
qualitylayer peers send --to 'cc:<name-or-uuid>' --message-file ./review-request.txt --json
```

Address `cc:`, `codex:`, `pi:`, `opencode:`, `copilot:`, `grok:`, `cursor:` or `antigravity:` plus a name or UUID. `peers help` lists the reply commands; `peers doctor` finds a missing session.

GitHub Copilot, Grok, Cursor and Antigravity sessions join the list at their first hook. Messages arrive:

- At once in a waiting App session.
- At turn end or the next prompt while the agent works.
- At the next turn in an idle terminal.

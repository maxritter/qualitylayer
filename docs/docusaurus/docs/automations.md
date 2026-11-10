---
title: Automations
description: Send task events to your own tools, and read or start tasks from a script.
---

# Automations

Send task events to your own tools, and read or start tasks from a script.

## Add an automation

- **App**: Settings › Automations › **Add**.
- **Your agent**: “Send QualityLayer events to https://example.com/hook.”
- **CLI**: `qualitylayer automations add --url https://example.com/hook`

A URL receives each event as signed JSON. A command receives the same JSON on its input: `qualitylayer automations add --command "./scripts/on-event.sh"`. Add `--events task.shipped,task.merged` to send only some events, and `--projects shop` to send only some projects' tasks.

| Command | What it does |
| --- | --- |
| `automations list` | Your automations, with each one's last delivery |
| `automations set <id> --off` | Turn one off or on, or change its target or events |
| `automations test <id>` | Send a test event now |
| `automations log [<id>]` | The last deliveries and why one failed |
| `automations remove <id>` | Remove one |

Every command takes `--json`.

## Events

| Event | When |
| --- | --- |
| `task.created` | A task starts |
| `task.step_changed` | A task moves to another step |
| `question.asked` | The agent asks you something |
| `question.answered` | You answer |
| `approval.requested` | A Plan or a finished change waits for your approval |
| `approval.decided` | You approve or ask for changes |
| `task.verified` | Verify passes |
| `task.shipped` | You approve the finished change |
| `task.merged` | Its pull request is merged |
| `task.archived` | A task is archived |

## What an event carries

```json
{
  "id": "evt_01JCK2M8Q4",
  "event": "task.step_changed",
  "at": "2026-11-10T09:41:07.120Z",
  "version": 1,
  "project": { "id": "shop-4f2a91c07b1e", "name": "shop" },
  "task": {
    "id": "shop-4f2a91c07b1e~2026-11-10-csv-export",
    "title": "CSV export",
    "type": "feature",
    "step": "plan",
    "link": "http://127.0.0.1:41888/#/task/shop-4f2a91c07b1e~2026-11-10-csv-export"
  },
  "data": { "from": "research", "to": "plan" }
}
```

A retry repeats the same `id`, so a receiver can drop an event it already has. The link opens the task in the App on the computer that sent it.

A URL also gets the header `QualityLayer-Signature: t=<time>,v1=<signature>`. The signature is the HMAC-SHA256 of `<time>.<body>` with the automation's signing secret, shown once when you add it and again with `automations secret <id>`.

## Run a command

```sh
#!/bin/sh
# ./scripts/on-event.sh: move the ticket when a task ships
event=$(cat)
[ "$(echo "$event" | jq -r .event)" = "task.shipped" ] || exit 0
title=$(echo "$event" | jq -r .task.title)
./scripts/close-ticket.sh "$title"
```

The command runs once per event on your computer, in the task's project folder, and may take up to 60 seconds.

## Delivery

- Events are sent from the computer that runs the task. Nothing passes through qualitylayer.dev.
- An event carries the task's title and, for a question, its text, to the target you set. It never carries your answer.
- A URL that fails is tried six times over about nine hours, then given up. A command runs once; its exit code is kept.
- A failing automation never holds a task. Settings › Automations and `automations log` show what failed.
- QualityLayer keeps running in the background until a failed delivery's tries are done. After sleep or a restart they go on.

## Read and start tasks from a script

| Command | Returns |
| --- | --- |
| `tasks --json` | The project's tasks with id, title, step and dates |
| `status --task <task> --json` | One task's step, progress and what it waits for |
| `tasks --cost --since 30d --json` | Each task of the period with its step, cost, active time and tokens |
| `task start "<request>" --json` | A new task that waits on Home; its id |
| `task start "<request>" --plan [--agent <id>]` | The same, and planning starts with your default agent, or the one `--agent` names |

Run them in the project's folder. `--plan` starts an agent on your plan with every call. On a machine without a screen, such a task asks its questions in the App. `tasks --cost` answers within 20 seconds; when it says `"complete": false`, run it again for the rest.

## What stays with you

No event and none of these commands approves a Plan or a finished change, or answers a question.

---
title: Automations
description: Send task events to your own tools as signed webhooks or commands, and read or start tasks from a script.
---

# Automations

Send task events to your own tools, and read or start tasks from a script.

## Your first webhook in 2 minutes

1. Save this receiver as `receiver.mjs`:

   ```js
   import { createHmac, timingSafeEqual } from "node:crypto"
   import { createServer } from "node:http"

   const secret = process.env.QL_SECRET ?? ""
   createServer((req, res) => {
     let body = ""
     req.on("data", (chunk) => (body += chunk))
     req.on("end", () => {
       const [t, v1] = (req.headers["qualitylayer-signature"] ?? "")
         .split(",")
         .map((part) => part.slice(part.indexOf("=") + 1))
       const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")
       const ok = v1?.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected))
       console.log(ok ? "verified" : "bad signature", JSON.parse(body).event)
       res.writeHead(ok ? 200 : 401).end()
     })
   }).listen(8787)
   ```

2. Add it: `qualitylayer automations add --url http://127.0.0.1:8787/hook`. The reply shows the automation's `id` and its signing `secret`.
3. Start the receiver with that secret: `QL_SECRET=<secret> node receiver.mjs`.
4. Send a test event: `qualitylayer automations test <id>`. The receiver prints `verified automation.test`.

From now on every task event reaches it. In the App, the same steps are Settings › Automations › **Add**, then the send button on its row. Your agent can do it too: “Send QualityLayer events to https://example.com/hook.”

## Manage automations

| Command | What it does |
| --- | --- |
| `automations add --url <url>` | Send events to a URL as signed JSON |
| `automations add --command "<command>"` | Run a command with each event as JSON on its input |
| `automations list` | Your automations, with each one's last delivery |
| `automations set <id> --off` | Turn one off or on, or change its target, `--events` or `--projects` |
| `automations test <id>` | Send a sample `automation.test` event now and print the result |
| `automations log [<id>]` | The last deliveries, newest first, and why one failed |
| `automations secret <id>` | A URL's signing secret |
| `automations events` | The event names |
| `automations remove <id>` | Remove one and drop what waits for it |

Every command takes `--json`. `--events task.shipped,task.merged` sends only some events; `--projects shop` sends only some projects' tasks. Both default to all.

## Events

Every event has the same envelope. `task.step` is `plan`, `implement`, `verify` or `shipped`.

```json
{
  "id": "evt_6f1c0a93d27e4b58",
  "event": "task.step_changed",
  "at": "2026-11-11T09:41:07.120Z",
  "version": 1,
  "project": { "id": "shop-4f2a91c07b1e", "name": "shop" },
  "task": {
    "id": "shop-4f2a91c07b1e~2026-11-11-csv-export",
    "slug": "2026-11-11-csv-export",
    "title": "CSV export",
    "type": "feature",
    "step": "implement",
    "link": "http://127.0.0.1:41888/#/task/shop-4f2a91c07b1e~2026-11-11-csv-export"
  },
  "data": { "from": "plan", "to": "implement" }
}
```

| Event | When | `data` |
| --- | --- | --- |
| `task.created` | A task starts | `{}` |
| `task.step_changed` | A task moves to another step | `{"from": "plan", "to": "implement"}` |
| `question.asked` | The agent asks you something | `{"count": 1, "questions": ["Which export format?"]}` |
| `question.answered` | You answer | `{"question": "Which export format?"}` |
| `approval.requested` | The Plan, or the change after Verify's checks, waits for your approval | `{"for": "plan"}` or `{"for": "verify"}` |
| `approval.decided` | You approve or ask for changes | `{"for": "verify", "decision": "approved"}`, or `"changes"` |
| `task.verified` | Verify's checks pass and the change waits for your review | `{"round": 1}`, the checking round that passed |
| `task.shipped` | You approve the finished change | `{"slices": 2}` |
| `task.merged` | Its pull request is merged | `{"url": "https://github.com/acme/shop/pull/42", "number": 42}` |
| `task.archived` | A task is archived | `{}` |

From start to shipped, a task sends these events in order. Question events come whenever the agent asks.

```text
task.created
approval.requested   {"for": "plan"}
approval.decided     {"for": "plan", "decision": "approved"}
task.step_changed    {"from": "plan", "to": "implement"}
task.step_changed    {"from": "implement", "to": "verify"}
task.verified        {"round": 1}
approval.requested   {"for": "verify"}
approval.decided     {"for": "verify", "decision": "approved"}
task.step_changed    {"from": "verify", "to": "shipped"}
task.shipped         {"slices": 2}
```

`link` opens the task in the App on the computer that sent the event. A test send has the event `automation.test` and a sample task.

## Signature

A URL receives a `POST` with these headers:

| Header | Value |
| --- | --- |
| `QualityLayer-Event` | The event's name |
| `QualityLayer-Delivery` | The event's `id`, the same on every retry |
| `QualityLayer-Signature` | `t=<unix seconds>,v1=<hex>` |

`v1` is the HMAC-SHA256 of `<t>.<body>` with the automation's signing secret, as in the receiver above. `t` is the time of that try, so you can refuse old ones. Compare signatures in constant time, and drop an event whose `id` you already have.

## Delivery and retries

- A 2xx answer within 10 seconds is delivered. Redirects are not followed.
- A URL that fails is tried again after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then given up. Every try sends the same body and `id`.
- One task's events arrive in order: a later event waits while an earlier one is retried. Other tasks go on.
- A failing automation never holds a task. Settings › Automations and `automations log` show what failed.
- QualityLayer keeps running in the background until a failed delivery's tries are done. After sleep or a restart they go on.
- Events are sent from the computer that runs the task. Nothing passes through qualitylayer.dev. An event carries the task's title and, for a question, its text. It never carries your answer.

## Run a command

```sh
#!/bin/sh
# ./scripts/on-event.sh: close the ticket when a task ships
event=$(cat)
[ "$QUALITYLAYER_EVENT" = "task.shipped" ] || exit 0
./scripts/close-ticket.sh "$(echo "$event" | jq -r .task.title)"
```

`qualitylayer automations add --command "./scripts/on-event.sh"` runs it once per event, in the task's project folder, with the event's name in `QUALITYLAYER_EVENT`. It has 60 seconds. Exit 0 is delivered; a command is never run twice, and its exit code and last output are kept in the log.

## Read and start tasks from a script

| Command | Returns |
| --- | --- |
| `tasks --json` | The project's tasks with id, title, step and dates |
| `status --task <task> --json` | One task's step, progress and what it waits for |
| `tasks --cost --since 30d --json` | Each task of the period with its step, cost, active time and tokens |
| `task start "<request>" --json` | A new task that waits on Home, with its id |
| `task start --from <link> --json` | The same, from a GitHub or GitLab issue or pull request, a Jira issue or a Confluence page |
| `task start "<request>" --plan [--agent <id>]` | The same, and planning starts with your default agent, or the one `--agent` names |

Run them in the project's folder. `--plan` starts an agent on your plan with every call. `tasks --cost` answers within 20 seconds; when it says `"complete": false`, run it again for the rest.

## What stays with you

No event and none of these commands approves a Plan or a finished change, or answers a question.

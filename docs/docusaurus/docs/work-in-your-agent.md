---
title: Work only in your agent
description: Run the seven steps in your coding agent's chat, and answer and approve there without opening the App.
---

The seven steps run in your agent's chat. You answer questions and approve the Plan and the final Review there. Open the App only when you want to read the documents or review the code in it.

## Start a task {#start}

Say “Using QualityLayer, plan a CSV export”, or type `/ql plan a CSV export` (`$ql` in Codex).

You can also ask your agent to plan without naming QualityLayer. It offers QualityLayer once, and you pick **Yes** or **No**. An ordinary coding request never starts a workflow on its own.

The offer is on by default. To turn it off, clear **Offer QualityLayer** in [Settings › Workflow](reference/settings.md#workflow), or run:

```sh
qualitylayer settings set offerWorkflow false
```

## Choose where you answer and approve {#where}

Your first task started in your agent asks once, in the agent's own picker:

- **Here in Claude Code** (your agent's name): questions and approvals
- **In the App**: questions and approvals
- **Questions here, approvals in the App**

Your pick is saved as the two Workflow rows and is not asked again. Change them in Settings › Workflow (**Answer questions in** and **Approve in**), or from the command line (`app` sends it to the App). The rows also allow questions in the App with approvals in your agent:

```sh
qualitylayer settings set answers terminal
qualitylayer settings set approvals terminal
```

For one task only:

```sh
qualitylayer task set answers=terminal approvals=app
```

Tasks you start in the App always answer in the App.

## What you see in your agent {#what-you-see}

- **Questions** in Discuss, Research and Plan appear in the agent's own picker.
- **Plan**: a short summary and the path of the full file, any **Your call** to settle, then **Approve Plan**, **Give feedback** or **Show the Plan**.
- **Build**: after you approve, choose where to build: **Build here**, **Compact first, then build here** or **Another session**.
- **Review**: the final approval.

Only your own pick or words count as an answer or an approval. An example at the Plan, with a fictional task:

```text
Plan ready: Add a CSV export to the Orders page
Adds an Export button that downloads the rows you filtered.
Full text: docs/plans/csv-export/03-plan.md

  Approve Plan
  Give feedback
  Show the Plan
```

## Agents and pickers {#pickers}

| Agent | How you answer |
| --- | --- |
| Claude Code, Codex, Pi, OpenCode, Grok, Antigravity, GitHub Copilot | The agent's own picker |
| Cursor | Numbered choices in the chat. Type the number or your own words. |

Setup turns on Codex's question picker and lets Grok's questions wait for you instead of expiring. If you turned the picker off in Codex's own settings, Codex uses numbered choices instead. `qualitylayer doctor` shows whether each installed agent's picker is ready.

## Use the App anyway {#app}

A task that answers in your agent still shows in the App. Its open question appears read-only, with **Answer here instead** if you would rather answer there.

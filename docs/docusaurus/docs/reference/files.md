---
title: Files and privacy
description: What a task writes into your repository, what stays on your computer, and what leaves it.
---

## A task's files

![A task folder in docs/plans: seven documents, local interactive artifacts, reviews, command output, and evidence pictures and recordings](pathname:///img/diagrams/files-light.svg)
![A task folder in docs/plans: seven documents, local interactive artifacts, reviews, command output, and evidence pictures and recordings](pathname:///img/diagrams/files-dark.svg)

Each task gets a folder in `docs/plans/`: plain Markdown, committed with the change and never touched by uninstalling.

| In the folder | What it holds |
| --- | --- |
| **The seven documents** | One per step that runs ([below](#documents)) |
| `original-plan.md` | A plan supplied through Existing plan or saved in Chat, unchanged |
| `artifacts/` | Local artifacts and their revisions. Shared only with **Include artifacts** |
| `reviews/` | The Plan review and second opinion, when they ran |
| `records/` | The raw output of every command, and `pull-request-body.md` |
| `evidence/` | Pictures and recordings the checks made |
| `chat-plan.md`, `chat-slices.md` | A [Chat](../chat.md)'s saved plan and its build outline |

## The seven documents {#documents}

Each opens with what you read first; code shapes, paths and commands follow in the Reader. QualityLayer refuses a document whose marked sections were edited by hand.

| File | What it holds |
| --- | --- |
| `01-discuss.md` | Your request, the problem, **Done means**, scope and decisions |
| `02-research.md` | **How it works today:** a picture of the code, findings, risks and tests. A bug's is **Why it breaks** |
| `03-plan.md` | The decided design, artifacts, **Not doing**, **Before the build** and who reviewed it |
| `04-outline.md` | Where the change lands, the slices, checks and build commands |
| `05-implement.md` | Slice progress, checks and decisions |
| `06-verify.md` | Each point with its evidence, and what is still open |
| `07-review.md` | The pull request's description, change details and approval |

## Lasting artifacts {#lasting}

| Location | What it holds |
| --- | --- |
| `.qualitylayer/artifacts/<name>/` | A [lasting artifact](../artifacts.md#keep) and its `artifact.json`, committed with the change (older `.qualitylayer/designs/` still read) |
| `docs/artifacts/` | Artifacts kept only on this computer, out of git |
| `~/.qualitylayer/project-look.json` | Sidebar order, colors, names and hidden projects. Delete it to reset |

## What stays on your computer, and what leaves it {#privacy}

Your code, diff, documents, evidence and costs stay on your computer until you share. Your agent still sends code to its own provider, as always.

| | What is sent |
| --- | --- |
| **Always** | A daily licence check to qualitylayer.dev (plus activation or trial start), the workflow texts your agent follows, and App updates. No usage events |
| **When you share** | Tasks, documents and comments, encrypted on your computer with your team's key. **Include artifacts** adds previews (off for existing shares). The server sees names, e-mails, the step and when, never the content. A share link's key never reaches the server |
| **When your team reviews code** | **Ask for review** pushes the branch to your own Git remote. QualityLayer stores the team's line comments, the quoted lines (up to 300 characters each) and the commits, encrypted with your team's key, never the code |
| **Not included automatically** | Source, diffs, host logs, launch settings, terminal output and command output. Text or attachments you share can contain anything. Shared artifact previews run no scripts |
| **With Slack** | The task title and the question, through the QualityLayer server |
| **Instructions** | Yours stay local and go to your agent, so a cloud agent may send them to its provider. Team instructions are encrypted with the team's key |
| **Lessons and lasting artifacts** | Travel through your Git pushes only where you keep them in the repository or turn on [memory sharing](../memory.md) |

The QualityLayer API runs in Frankfurt; backups are encrypted and kept in the EU. Terminal output of App runs stays in local folders only you can read, never in shared copies. A screenshot you attach to feedback can show it, so check it first.

## Report a problem {#feedback}

**Report bug / idea** in the sidebar files a public issue on `maxritter/qualitylayer`: add a title, description and screenshots, choose **Preview public issue**, then **Create public GitHub issue**. Use **Private support** for confidential details. The report adds QualityLayer, operating-system and architecture details and the agent version; it does not add your account name, email, repository paths or terminal logs.

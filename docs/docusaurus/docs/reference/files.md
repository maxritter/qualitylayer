---
title: Files and privacy
description: What a task writes into your repository, what stays on your computer, and what leaves it.
---

## A task's files

![A task folder in docs/plans: seven documents, local interactive artifacts, reviews, command output, and evidence pictures and recordings](pathname:///img/diagrams/files-light.svg)
![A task folder in docs/plans: seven documents, local interactive artifacts, reviews, command output, and evidence pictures and recordings](pathname:///img/diagrams/files-dark.svg)

Each task gets a folder in `docs/plans/`: plain Markdown, kept on disk and never touched by uninstalling. You decide whether to commit these documents; QualityLayer does not stage or commit them automatically.

| In the folder | What it holds |
| --- | --- |
| **The seven documents** | One per step that runs ([below](#documents)) |
| `original-plan.md` | A plan supplied through Existing plan or saved in Chat, unchanged |
| `artifacts/` | Local artifacts and their revisions. |
| `reviews/` | The Plan review and second opinion, when they ran; with a panel, also each reviewer's answer of both rounds |
| `records/` | The raw output of every command, and `pull-request-body.md` |
| `evidence/` | Pictures and recordings the checks made |
| `chat-plan.md`, `chat-slices.md` | A [Chat](../chat.md)'s saved plan and its build outline |

## The seven documents {#documents}

Each opens with what you read first; code shapes, paths and commands follow in the Reader. QualityLayer refuses a document whose marked sections were edited by hand.

| File | What it holds |
| --- | --- |
| `01-discuss.md` | Your request, the problem, **Done means**, scope and decisions |
| `02-research.md` | **How it works today:** a picture of the code, findings, risks and tests. A bug's is **Why it breaks** |
| `03-plan.md` | The decided design, artifacts, **Not doing**, **Before the build** and who reviewed it, written for people |
| `agents/03-plan.md` | Notes for the build: code to follow, how to run and test, pitfalls. It grants nothing; the Plan wins |
| `04-outline.md` | Where the change lands, the slices, checks and build commands |
| `05-implement.md` | Slice progress, checks and decisions |
| `06-verify.md` | A summary and one line per check stage |
| `agents/06-verify.md` | What the agents fix from: failing points, findings, commands, security review and every judged round |
| `07-review.md` | The pull request's description: why, where to start reading, the change in diagrams, the screens and the acceptance test as it ran |
| `agents/07-review.md` | What the agents ship and follow up from |

## Lasting artifacts {#lasting}

| Location | What it holds |
| --- | --- |
| `.qualitylayer/artifacts/<name>/` | A [lasting artifact](../artifacts.md#keep) and its `artifact.json`, committed with the change (older `.qualitylayer/designs/` still read) |
| `docs/artifacts/` | Artifacts kept only on this computer, out of git |
| `docs/memories/` | Project lessons you [export](../memory.md) to Git, with a readable `LESSONS.md`; you commit them |
| `~/.qualitylayer/project-look.json` | Sidebar order, colors, names and hidden projects. Delete it to reset |

## What stays on your computer, and what leaves it {#privacy}

Your code, diff, documents, evidence, memories and costs stay on machines you control. Your chosen agent may send its context to its provider under your account and settings.

| Destination | What is sent |
| --- | --- |
| **Licence and trial service** | A licence check, activation or trial request with the identifiers needed for entitlement. Existing trial dates and the offline allowance stay unchanged |
| **Downloads and updates** | Requests for the official App, CLI, update information and release notes |
| **Your coding agent** | Your request, project instructions and relevant context, through the agent's native integration |
| **Automations** | Task events, including titles and question text, to the URL or command you explicitly configure. Nothing passes through qualitylayer.dev |
| **Your own Git remote** | Files you authorize committing and pushing, including optional project [memory exports](../memory.md). Repository readers can read them |
| **Your own remote machine or paired browser** | Your local work over the authenticated connection you configure; no hosted collaboration workspace is created |
| **Support** | The report, diagnostics and screenshots you review before sending, through the separate product-support service |

Official releases contain their matching readable workflow instructions, templates, schemas and skills locally. Running a workflow does not download instructions from a hosted store. Licensing remains required; public instruction text is not a free product licence.

Personal lessons, private session attribution, credentials, transcripts and terminal streams stay outside project memory exports. Existing tasks, question answers, approval records, artifacts and sessions remain local. Retired annotations and attachments are read-only private records; they never grant approval or create a new agent message.

Older clients can continue to use retained services during migration. The [privacy policy](https://qualitylayer.dev/privacy) describes that transitional processing separately. An upgrade does not itself delete remote records or shorten existing retention obligations.

## Report a problem {#feedback}

**Report bug / idea** in the sidebar foot (**Bug / idea** in a narrower sidebar) files a public issue on `maxritter/qualitylayer`: add a title, description and screenshots, choose **Preview public issue**, then **Create public GitHub issue**. Use **Private support** for confidential details. The report adds QualityLayer, operating-system and architecture details and the agent version; it does not add your account name, email, repository paths or terminal logs.

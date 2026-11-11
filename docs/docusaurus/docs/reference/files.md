---
title: Files and privacy
description: What a task writes into your repository, what stays on your computer, and what leaves it.
---

## A task's files

![A task folder in docs/plans: three documents with their agents' files, local interactive artifacts, reviews, command output, and evidence pictures and recordings](pathname:///img/diagrams/files-light.svg)
![A task folder in docs/plans: three documents with their agents' files, local interactive artifacts, reviews, command output, and evidence pictures and recordings](pathname:///img/diagrams/files-dark.svg)

Each task gets a folder in `docs/plans/`: plain Markdown, kept on disk and never touched by uninstalling. You decide whether to commit these documents; QualityLayer does not stage or commit them automatically.

| In the folder | What it holds |
| --- | --- |
| **The three documents** | One per step, each with a file for agents ([below](#documents)) |
| `research/` | The helpers' reports, one per question |
| `original-plan.md` | A plan supplied through Existing plan or saved in Chat, unchanged |
| `artifacts/` | Local artifacts and their revisions. |
| `reviews/` | The Plan review and second opinion, when they ran; with a panel, also each reviewer's answer of both rounds |
| `records/` | The raw output of every command, and `pull-request-body.md` |
| `evidence/` | Pictures and recordings the checks made |
| `chat-plan.md`, `chat-slices.md` | A [Chat](../chat.md)'s saved plan and its build outline |

## The three documents {#documents}

Each opens with what you read first; code shapes, paths and commands follow in the Reader. Each fact is written once, in one file. QualityLayer refuses a document whose marked sections were edited by hand.

| File | What it holds |
| --- | --- |
| `01-plan.md` | What you approve: the problem, **Done means** with their steps, scope, diagrams, artifacts, the approach and the decisions. Its front matter holds the task's identity |
| `agents/01-plan.md` | Notes for the build: constraints, findings, code to follow, how to run and test, pitfalls. It grants nothing; the Plan wins |
| `02-implement.md` | The slices, what was decided while building and known limits |
| `agents/02-implement.md` | The task cards and the build's notes |
| `03-verify.md` | The pull request's description: why, the code, the change in diagrams, the screens and **Done means** as it ran |
| `agents/03-verify.md` | Verdicts, findings, commands, security review, fix rounds, ship steps and follow-ups |

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

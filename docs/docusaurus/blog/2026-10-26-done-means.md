---
title: "The list I write before my coding agent touches anything"
description: "Coding agents fill every open question with a guess. A short Done means list puts my judgment back at the start and gives me something to check the result against."
slug: done-means
date: 2026-10-26
authors: [max-ritter]
tags: ["guide","workflow"]
image: https://qualitylayer.dev/og.png
---

Coding agents write most of my code now. Even the best models still don't build software the way an experienced engineer would. They don't know the users, the history of the codebase or what the team considers good design. An engineer settles those questions before writing code.

An agent guesses.

The habit that helped me most is a small one. Before the agent writes any code, the agent and I agree on a numbered list of results. The change is accepted when all of them hold. I call it "Done means". It brings my own judgment back into the loop, with or without a tool.

<!-- truncate -->

## Why the list matters

Say I give an agent "add CSV export to the reports page". It fills every open question with a guess. Does the export respect the filters? What happens with 50,000 rows? Which columns go into the file? The agent picks an answer for each one and writes the code. I find its answers in the diff later.

In my experience, working out decisions from a diff is the slowest part of working with agents. A Done means list moves those decisions to the start. They are easy to change there, and I'm the one making them.

## How I write it

I let the agent do most of the work. In Claude Code I use plan mode, in Codex `/plan`, and I give it a prompt like this:

```text
Read the code that this change touches. Then ask me up to six questions
that decide how the change behaves. For each question, give your
recommended answer. After my answers, write a numbered "Done means" list.
Each item must be a result a person can check on the running program.
```

The recommended answers are the important part. I accept most of them with one keystroke. The two or three I change are the real decisions.

Those needed an engineer.

A good list for this example export:

1. The reports page shows an "Export CSV" button next to the filters.
2. The file contains the rows that match the current filters, in the current sort order.
3. The columns match the visible table columns, with the same headers.
4. An export of 50,000 rows finishes while the page stays responsive.
5. The existing PDF export keeps working.

Each line is something I could check myself in a minute. "Export works" is too vague, because it doesn't say which behavior to check.

Item 5 is the one people skip. Every change should name what must keep working, because that's where agents break things quietly.

## A list for bugs

For a bug I use four parts:

- When: the steps that trigger it.
- What happens: the wrong behavior.
- Expected: the right behavior.
- Must keep working: the nearby behavior the fix must not change.

## Using the list at the end

The list pays off a second time after the build. I open a new session that hasn't seen the build. I give it the list and ask it to check one point at a time on the running program:

```text
For each item in Done means, run the program or the tests and show me
the evidence: command output, a screenshot or a file. If you cannot check
an item, say so and tell me what I need to do to check it myself.
```

The new session matters. The session that wrote the code knows what it meant to do. It tends to report that instead of what the code does.

I get back a short report with evidence per point. I read that first. Then I look at the diff and know where to look.

## How I do this in QualityLayer

QualityLayer is built around this list. Its [Discuss step](/docs/steps/discuss) runs this conversation for every change, and the list ends up in the [Plan](/docs/steps/plan) I approve before any code exists. After the build, an agent that didn't write the code [checks every point](/docs/steps/verify) and shows me the evidence. Anything it can't check stays open for me at [Review](/docs/steps/review). It works with Claude Code, Codex, OpenCode, Pi and others, and the list is a Markdown file in the repo.

In my view, everybody who writes software is becoming a manager of agents. The list is how I stay the engineer in that setup: I decide, review and steer, and the agent does the typing.

You don't need a tool to start, though. Write the list, check against it, and see how your reviews change.

## Read next

- [Plan modes leave the engineer out of the loop](/blog/engineer-in-the-loop): why I want the plan to be a shared document
- [Human in the loop AI coding](/blog/human-in-the-loop-ai-coding): where the engineer decides when an agent builds
- [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode) and [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode)
- [QualityLayer on GitHub](https://github.com/maxritter/qualitylayer)

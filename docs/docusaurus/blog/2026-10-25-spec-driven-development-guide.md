---
title: "Spec-driven development with Claude Code, Codex and Cursor"
description: "How to run spec-driven development with the coding agent you already use: agree on done, write a plan you can review, build test first and check the result against the spec."
slug: spec-driven-development-guide
date: 2026-10-25
authors: [max-ritter]
tags: ["guide","workflow"]
image: https://qualitylayer.dev/og.png
---

Spec-driven development means you and the agent write down what a change should do before any code exists, and then you check the finished code against that written spec. Even the best coding models don't build software the way an experienced engineer would. The spec is where your engineering judgment comes back into the loop. I built QualityLayer around this method because it was the only way I found to keep medium and large agent changes reviewable. This guide shows the method itself. You can follow it by hand in any agent, and at the end I explain which parts QualityLayer automates.

<!-- truncate -->

## Step 1: Agree on what "done" means

Start with a short list of outcomes that a person could check on the running program. I call it "Done means". Each line describes one result, for example "The export button downloads a CSV that respects the current filters". A line like "Add CSV export" is too vague, because nobody can check it.

Ask the agent to read the relevant code first and then ask you questions. In Claude Code you can do this in plan mode, in Codex with `/plan`, and in Cursor with its plan mode. Let the agent propose an answer for each question. You will accept most of them, and the few you change are the decisions that matter.

For a bug, the list has four parts: when it happens, what happens, what should happen, and what must keep working.

## Step 2: Research the code as it is

Before planning, have the agent describe how the affected code works today, with file references. I get better results when this research runs in a separate session that does not see the request. An agent that knows what you want tends to describe the code it hopes to find.

Keep the research short. You want the risks, the existing parts the change can reuse, and how the code is tested today.

## Step 3: Write a plan someone else can review

The plan is the spec. It should hold:

- the Done means list from step 1,
- each engineering decision in two sentences, with the alternative you rejected,
- a "Not doing" list of things the agent must leave alone,
- for UI work, a mockup.

Read the plan as if a colleague wrote it. If you would ask a question in code review, ask it now. This is the cheapest moment to change direction. A diagram helps a lot for anything with more than two moving parts, because you see a wrong dependency in seconds.

## Step 4: Split the build into test-first slices

Ask the agent to split the plan into slices. The first slice is the thinnest version that works end to end. Every slice starts with a failing test that describes the behaviour, and then the agent writes the code until the test passes.

Slices keep each step small enough that the agent's context stays focused. When something breaks, you know which slice broke it.

## Step 5: Check the result against the spec

When the build is finished, open a new session without the build history and ask it to go through the Done means list one point at a time. For each point it should run the program or the tests and show you the evidence: output, a screenshot or a file. Points it cannot check should be listed for you to confirm yourself.

This step finds the gaps that "all tests pass" hides, for example a test that checks the wrong thing.

## Step 6: Review and open the pull request

Now you review. You read the evidence, try the change yourself where it matters, and decide. Keep the plan and the evidence in the repository next to the code, so a reviewer can read why the change looks the way it does.

## Doing this with Claude Code, Codex and Cursor

All three agents can run every step by hand. Claude Code and Codex are strong at long build sessions, and Cursor is convenient when you want to watch the diff in the editor. The method works the same in each one, so pick the agent you already like. You can even plan with one agent and build with another.

## Where QualityLayer helps

Doing these six steps by hand takes discipline on every change. QualityLayer wraps the agent you already use and runs them as Discuss, Research, Plan, Outline, Implement, Verify and Review. The Plan has diagrams and clickable mockups that you and your team can comment on. An agent that did not write the code checks every Done means point with evidence, and you approve twice: the Plan and the finished change. Every step writes Markdown into your repo. See the [comparison of spec-driven development tools](https://qualitylayer.dev/best-spec-driven-development-tools) for other options.

## FAQ

**Is spec-driven development the same as writing a PRD?**
A PRD describes a product goal. A spec for an agent is smaller and checkable: a list of outcomes, decisions and limits for one change. QualityLayer can produce both, with the Product level writing a PRD.

**Does spec-driven development slow me down?**
For a one-line fix it does, so skip it there. For changes that touch several files, the time spent on the plan usually comes back during review.

**Which agent is best for spec-driven development?**
The method works with Claude Code, Codex, Cursor, OpenCode and Pi. Use the one you already know well.

**Do I need a special tool?**
No. You can follow the six steps with prompts and Markdown files. Tools like QualityLayer, Spec Kit or Kiro automate parts of it.

**Where should the spec live?**
In the repository, next to the code, as Markdown. Then the pull request reviewer and the next agent session can read it.

## Read next

- [Human in the loop AI coding](/blog/human-in-the-loop-ai-coding): where your judgement belongs when an agent builds
- [Your first task with QualityLayer](/docs/first-task)
- [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor plan mode](https://qualitylayer.dev/compare/cursor-plan-mode)
- [QualityLayer on GitHub](https://github.com/maxritter/qualitylayer)

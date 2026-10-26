---
title: "Human in the loop AI coding: where the engineer decides"
description: "Where you stay in the loop of a coding agent: you approve the plan before code exists and the finished change before the pull request. A guide for Claude Code, Codex and other agents."
slug: human-in-the-loop-ai-coding
date: 2026-10-25
authors: [max-ritter]
tags: ["guide","workflow"]
image: https://qualitylayer.dev/og.png
---

Even the best coding models don't build software like an experienced engineer. They can build most of a feature on their own. But they don't know your users, the history of your codebase or your team's taste in architecture. That's why I built QualityLayer. It puts the engineer back in the loop of your coding agent. You approve the plan before code exists. An agent that did not write the code checks the result. Then you approve the change, and it opens the pull request. This guide explains why those points matter and what the agent does in between.

<!-- truncate -->

## Why an agent needs a person at all

An agent fills gaps in a request with guesses. Most guesses are fine. A few of them decide how the feature behaves for users, or how the code will grow next year. The agent cannot know which guesses those are. Experienced engineers spend their time on exactly those decisions. They ask what the user needs, look at how the code works today, agree on an approach with the team, and only then write code.

When an agent skips that part, the decisions still get made. They just end up hidden in a large diff, and you find them during review or after release.

## Why plan modes are not enough

Claude Code, Codex and Cursor all have a plan mode. It is a good start, but a plan mode is neither collaborative nor visual. The plan is a chat message that only one person sees. The colleague who knows the payment code never gets a say. A long text plan also hides how the parts of a change depend on each other. To keep people in the loop, the plan has to be something a team can work on together.

## Where you stay in the loop

### Before code: you approve the plan

The best moment for your judgement is before the first line of code. A plan is short, cheap to change and easy to share with a colleague. In QualityLayer the agent first asks you what "done" means, with a recommended answer for every question. It then writes a Plan with diagrams for the engineering decisions and clickable mockups for UI work. Risky items are marked so you read them first. You can pin a comment on any part of a diagram, and the agent answers in the document.

Your teammates can join here too. You can ask a colleague about one decision in the Plan, and they can answer with their own agent. A product manager can review the user-facing part without reading the engineering detail.

### After the build: an agent that did not write the code checks it

Your review is easier when someone else has already checked the work. In QualityLayer, an agent that did not write the code runs the program. It checks every Done means point from the Plan and attaches output, screenshots or files as evidence. Anything it cannot check, such as a login only you hold, stays open for you.

### Before the pull request: you approve the change

At Review you see what was checked, what was decided while building and what still needs your eyes. You approve, and QualityLayer opens the pull request. It never merges.

## What happens in between

Between the approvals the agent works on its own. It splits the Plan into thin slices, writes a failing test for each slice, then writes the code. It does not stop to ask you small questions. Its choices go into a "Decided while building" list that you see at Review. It only asks for things only you can give, such as access to a service.

With coding agents, many developers have turned into agent managers. When you approve every step, you soon click through without reading. When you approve nothing, you end up reading every diff line by line. I want people to be engineers again. In QualityLayer your attention goes to two documents: the Plan before the build and the evidence at Review. The "Decided while building" list makes sure the small choices the agent made on its own still reach you.

## Making it work in your setup

You can follow this pattern with any agent. Write the plan in a Markdown file and review it. Let the agent build. Then ask an agent that did not write the code to check the result against the plan. QualityLayer runs these steps in Claude Code, Codex, OpenCode, Pi, Cursor, Grok and Antigravity, on the agent setup you already have. Every step writes Markdown into your repo, and your code stays on your machine. The source is on [GitHub](https://github.com/maxritter/qualitylayer).

## FAQ

**What does human in the loop mean for coding agents?**
A person makes the decisions that need knowledge of users, the product or the architecture. The agent does the work around them. In QualityLayer you approve the Plan, an agent that did not write the code checks the result, and you approve the finished change.

**Doesn't reviewing a plan take as long as reviewing code?**
A small Plan in QualityLayer takes about two minutes to read. It is much shorter than the diff it leads to, and changes to it cost nothing.

**Can my team review plans?**
Yes. You can share a Plan with your team. Teammates can comment or answer questions with their own agent, and guest links work without an account.

**Does the agent push or merge without me?**
No. QualityLayer only pushes with your approval and never merges.

**Which agents work with this approach?**
Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode have native support. Other agents that can run shell commands work through a copied prompt.

## Read next

- [Spec-driven development with Claude Code, Codex and Cursor](/blog/spec-driven-development-guide): the method step by step
- [The list I write before my coding agent touches anything](/blog/done-means): the Done means list, with or without a tool
- [The Plan step](/docs/steps/plan), [the Review step](/docs/steps/review) and [reviewing a Plan with your team](/docs/team/plans)
- [How QualityLayer compares to plan modes and other tools](https://qualitylayer.dev/compare)
- [QualityLayer on GitHub](https://github.com/maxritter/qualitylayer)

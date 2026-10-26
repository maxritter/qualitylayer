---
title: "Plan modes leave the engineer out of the loop"
description: "Agent plans arrive as chat text that only one person sees. I think the plan should be a shared document, so the engineer and the team can bring their judgment back into the loop."
slug: engineer-in-the-loop
date: 2026-10-26
authors: [max-ritter]
tags: ["guide","workflow"]
image: https://qualitylayer.dev/og.png
---

An experienced engineer does a lot of work before writing code. They find out what the user needs, look at how the code works today, and agree on an approach with the team. That knowledge sits with people. Product people know the users. Engineers know the codebase, the architecture and the taste of the team.

Even the best coding models still miss knowledge the team has. They are fast at writing the code.

I want that knowledge in the plan, before the agent builds anything. In my view, that's where the engineer belongs.

<!-- truncate -->

## What plan mode leaves out

[Claude Code](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor](https://qualitylayer.dev/compare/cursor-plan-mode) all have a plan mode, and I use them for small changes. The agent reads the code, asks a few questions and writes a plan. For a change that touches one or two files, that's enough.

For bigger changes I kept hitting the same limits. Plan modes are neither collaborative nor visual. The plan arrives as text in a chat window, and I'm the only person who sees it. A colleague who knows the payment code better than I do never gets to say "don't put that there". And a long text plan hides structure. A wrong dependency between two modules is easy to miss in paragraph four.

## Humans and agents working together

I think everybody who writes software is becoming a manager of agents. That only works if the way people and agents work together is designed for it. The agent does the typing. People do the deciding, reviewing and steering.

So in QualityLayer, the [Plan](/docs/steps/plan) lives in the repo as a document. Each engineering decision gets two sentences. Parts with several moving pieces get a diagram, because I spot a wrong dependency in a picture in seconds. Items the agent was unsure about are marked, so I read them first. I can comment on any part, and the agent answers in the document. When the plan is right, I approve it.

Only then does the build start.

## Bringing the team in

A plan only helps a team if the team can see it. I can [share a plan](/docs/team/plans) and ask one colleague about one specific decision. They answer in the App, or let their own agent draft an answer and send it after reading it. People without an account, for example a designer or a product manager, can join through a guest link.

For product people there is a [Product level](/docs/steps/discuss#product-level). With it, the plan shows what changes for users first, with the engineering detail one click away.

## After approval

After I approve the plan, the agent builds it in small slices, each starting with a failing test. An agent that didn't write the code [checks every point](/docs/steps/verify) the agent and I agreed on and shows me the evidence. At [Review](/docs/steps/review) I approve the finished change, and QualityLayer opens the pull request. It never merges.

The plan and the evidence stay in the repo. Whoever reviews the pull request can read why the change looks the way it does.

## Try the idea without a tool

You can get part of this with any agent. Ask it to write the plan as a Markdown file with a Mermaid diagram per decision. Commit it, and ask a colleague to comment on a pull request that contains only the plan. It takes a few minutes, and the comments arrive while changing direction is still easy.

What I want from all of this is to be an engineer again, with the agent doing the typing.

QualityLayer runs with Claude Code, Codex, OpenCode, Pi, Cursor, Grok and Antigravity.

## Read next

- [The list I write before my coding agent touches anything](/blog/done-means): the Done means list that the plan is checked against
- [Spec-driven development with Claude Code, Codex and Cursor](/blog/spec-driven-development-guide): the method step by step
- [How QualityLayer compares to plan modes and other tools](https://qualitylayer.dev/compare)
- [QualityLayer on GitHub](https://github.com/maxritter/qualitylayer)

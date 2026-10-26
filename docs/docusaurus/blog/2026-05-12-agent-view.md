---
title: "Claude Code Agent View: Manage Every Session in One List"
description: "Claude Code's agent view ships May 2026 as a single dashboard for every running session. Dispatch tasks, peek status, reply inline."
slug: agent-view
date: 2026-05-12
authors:
  - max-ritter
tags:
  - guide
  - agents
---

Claude Code's agent view ships May 2026 as a single dashboard for every running session. Dispatch tasks, peek status, reply inline.

<!-- truncate -->

**Problem**: Running three or four Claude Code sessions in parallel used to mean four terminal tabs, a tmux grid, and a mental list of which session is waiting on a decision. The moment you context-switch, you lose track of which agent finished, which one is paused for input, and which one is still chewing through a task.

**Quick Win**: Run `claude agents` from any session (or press the left arrow) to open a single list of every Claude Code session you have open. Each row shows the session, the last response, the timestamp, and whether the agent needs you. Reply inline without attaching, or press Enter to jump in.

```
You: claude agents
[Opens unified session list]
- session-2: needs input    -- "Should I bump the major version?"
- session-3: working        -- running pnpm test
- session-4: done           -- "PR #482 opened"
- session-5: idle           -- next scheduled run in 12m
```

Anthropic shipped **agent view** as a research preview on May 11, 2026. It is the official answer to a question the community has been hacking around for months: how do you supervise many concurrent Claude Code sessions without drowning in terminal panes?

## What Agent View Actually Does

Agent view is not a window manager bolted onto the CLI. It is a first-class session list with three core capabilities, all reachable from the keyboard.

### 1. Unified Session Dashboard

`claude agents` (or the left arrow from any active session) opens a list where every row is a live session. The row surfaces four signals at a glance: the session ID, whether it is waiting on you, the last assistant response, and the timestamp of the last interaction. PR babysitters, dashboard updaters, and other looping jobs also show their next scheduled run time right in the list, which removes the "is this thing actually still alive" guesswork that comes with long-running agents.

### 2. Inline Peek and Reply

Selecting a row previews the session's last turn without leaving the dashboard. If the agent paused for a decision, you can answer inline ("yes, ship it" or "no, use the smaller migration") and the session resumes. Pressing Enter opens the full transcript when you actually want to read the reasoning. This is the part that changes the workflow most: you stop attaching to sessions just to type three characters of approval.

### 3. Background Sessions

Two commands run sessions in the background instead of in your foreground terminal:

- `/bg` pushes the current session to the background while keeping it active
- `claude --bg "<task>"` launches a fresh background session without ever opening a foreground tab

Background sessions still appear in agent view, still surface when they need input, and still produce their final output. The terminal tab is no longer the unit of management. The session is.

## The Workflow This Unlocks

Pre-agent-view, dispatching parallel work looked like this: open a terminal, run `claude`, paste the task, switch to a new tab, repeat, then alt-tab between tabs hunting for the one waiting on input. The mental overhead grew quadratically with the number of agents.

With agent view, the flow flattens:

1. From any session, press the left arrow or run `claude agents`
2. Launch new background sessions with `claude --bg "refactor the billing module"` from inside the dashboard
3. Continue your foreground work; the dashboard fills up in the background
4. Glance at the list when you want to context-switch -- the rows tell you which agent is ready
5. Reply inline to unblock, or arrow-right back into the session that needs deep attention

This is the async pattern made native. Where background agents previously required `Ctrl+B` mid-session and `/tasks` polling, agent view promotes the session list to a top-level UI you live in.

## Where It Actually Earns Its Keep

Three use cases benefit immediately.

**Long-running jobs.** Scheduled agents -- the kind set up with [scheduled tasks](/blog/scheduled-tasks) -- now show their next run time in the same list as your active work. You stop wondering whether the 6 AM error-log check is still wired up.

**Domain-parallel work.** Run one session per layer of the stack. API session, frontend session, infrastructure session, tests session. Each one chips away at its domain. You become the integration point, not the bottleneck. This is the architecture pattern that has been theorized for the last year; agent view is what finally makes it operationally viable.

**Distributed PRs.** Dispatch six sessions to refactor six different modules, send them to the background, come back when the row says "PR opened." The peek title shows what shipped without forcing you to read the transcript.

## Pairing Agent View With Structured Orchestration

For solo workflows, the same combination matters. Use task distribution patterns to break a feature into parallel sub-tasks, let the [build-then-validate](/blog/team-orchestration) pattern pair each builder with a validator, and use agent view to watch the pairs land. The pieces existed before; agent view is the first time the pieces feel like one product.

## Availability and Limits

- **Status**: Research Preview (May 11, 2026)
- **Plans**: Pro, Max, Team, Enterprise, and Claude API
- **Rate limits**: Standard limits apply -- background sessions still draw from your usage budget
- **Opt-in**: Run `claude agents` or pass `--bg` to start using it today

Worth knowing: research preview means the keybindings, command names, and UI may shift before general availability. The underlying capability -- one list, every session -- is the part Anthropic is committing to.

## What Changes for How You Work

The honest summary is that agent view shifts Claude Code from synchronous-by-default to async-by-default. Before, the agent paused until you showed up. Now, you show up only when the agent needs you. The unit of attention is the queue, not the conversation.

That sounds incremental until you actually try it. Three sessions running in the background while you focus on a fourth produces measurably more output per hour, but the bigger shift is psychological: you stop treating each Claude session as a one-on-one conversation and start treating them as workers you supervise. The terminal tab stops being precious.

A few practical habits to adopt early:

- Name sessions when you spawn them with `/rename` so the dashboard reads like a task board, not a list of UUIDs
- Use `claude --bg` for anything that takes longer than thirty seconds; foreground only what you want to watch in real time
- Pair agent view with [scheduled tasks](/blog/scheduled-tasks) so recurring jobs surface in the same place as ad-hoc work
- Treat "needs input" as your only notification source; if a session is working, leave it alone

## Next Steps

- **Foundations**: Understand how agents work before scaling to many parallel sessions
- **Execution patterns**: Pick the right [parallel, sequential, or background pattern](/blog/sub-agent-best-practices) for each task
- **Async deep dive**: Learn the full async workflow model that agent view formalizes
- **Multi-agent coordination**: Use [team orchestration](/blog/team-orchestration) to pair builders with validators inside agent view
- **Recurring work**: Wire up [scheduled tasks](/blog/scheduled-tasks) so they live alongside ad-hoc sessions

Agent view is the missing dashboard. Once you stop alt-tabbing between sessions and start scanning a list, you will not go back -- and the ceiling on how many agents you can usefully run goes up by an order of magnitude.

Agent Fundamentals
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** adds a structured workflow on top of your coding agent: you approve the plan, helper agents build and test it slice by slice, and a fresh agent verifies the result against your request. The orchestration loop most agent setups end up writing by hand.

Running several agents in parallel? See [QualityLayer vs Claude Squad](https://qualitylayer.dev/compare/claude-squad) and [QualityLayer vs Conductor](https://qualitylayer.dev/compare/conductor).

[Try QualityLayer →](https://qualitylayer.dev)

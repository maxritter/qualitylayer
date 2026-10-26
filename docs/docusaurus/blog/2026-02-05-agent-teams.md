---
title: "Claude Code Agent Teams: Setup & Usage Guide 2026"
description: "Run multiple Claude sessions in parallel for multi-file refactors, test suites, and cross-domain work. Setup, patterns, and real examples."
slug: agent-teams
date: 2026-02-05
authors:
  - max-ritter
tags:
  - guide
  - agents
---

Run multiple Claude sessions in parallel for multi-file refactors, test suites, and cross-domain work. Setup, patterns, and real examples.

<!-- truncate -->

**Problem**: You're managing a complex codebase refactor that touches the API layer, database migrations, test coverage, and documentation. A single Claude Code session handles one piece at a time. Subagents can parallelize work, but they report results back in isolation. They can't share findings, challenge assumptions, or coordinate directly with each other. When you need real collaboration between AI workers, subagents hit a wall.

**Quick Win**: Enable Claude Code Agent Teams and orchestrate a collaborative team in one prompt:

```
# Add to your environment or settings.json
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Then tell Claude:

```
Create an agent team to refactor the payment module. Spawn three teammates:
one for the API layer, one for the database migrations, one for test coverage.
Have them coordinate through the shared task list.
```

Claude creates a team lead, spawns three independent teammates, and coordinates their work through a shared task list and direct messaging. Each teammate owns their scope. No conflicts, no isolation.

**Note on terminology**: This post covers Claude Code's native Agent Teams feature, an experimental built-in system for multi-agent collaboration. If you're looking for DIY builder-validator patterns using the Task tool, see [team orchestration with builder-validator chains](/blog/team-orchestration). Both approaches enable multi-agent workflows, but they work very differently under the hood.

## What Are Claude Code Agent Teams?

Agent Teams is an experimental feature that lets you orchestrate teams of Claude Code sessions working together on a shared project. One session acts as the team lead. It coordinates work, assigns tasks, and synthesizes results. Teammates work independently, each in its own context window, and communicate directly with each other.

The key difference from subagents is communication. Subagents run within a single session and can only report results back to the main agent. They can't message each other, share discoveries mid-task, or coordinate without the main agent acting as intermediary. Agent Teams removes that bottleneck entirely. Teammates message each other, claim tasks from a shared list, and work through problems collaboratively. You can interact with individual teammates directly without going through the lead.

Think of it this way: subagents are contractors you send on separate errands. Agent Teams is a project team sitting in the same room, each working on their piece while staying in sync through conversation. It's the difference between managing a freelancer queue and managing a full crew.

## Why Claude Code Agent Teams Matter Now

Anthropic shipped Agent Teams as an experimental feature with the Opus 4.6 release, marking a significant step in agentic workflows. The community had been building similar patterns independently for months, using tools like OpenClaw and custom orchestration scripts. Anthropic recognized the demand and built it into Claude Code natively.

This is significant for three reasons:

1. **Native integration beats bolted-on solutions.** The shared task list, mailbox system, and teammate lifecycle management are built into Claude Code's core. No external dependencies, no fragile scripts.
2. **The multi-agent paradigm is maturing.** Developers who build muscle memory with agent teams now will have a serious edge as these tools evolve. The gap between "uses Claude Code" and "orchestrates Claude Code teams" will widen.
3. **Complex projects demand collaboration, not just parallelism.** A task distribution strategy gets you parallel execution. Agent Teams gets you parallel execution with active coordination, where teammates can share context, challenge each other's approaches, and converge on better solutions together.

## When to Use Claude Code Agent Teams

Agent Teams add coordination overhead and use significantly more tokens than a single session. They work best when teammates can operate independently on distinct scopes while still benefiting from communication.

### Strong Use Cases

- **Research and review**: Multiple teammates investigate different aspects of a problem simultaneously, then share and challenge each other's findings
- **New modules or features**: Teammates each own a separate component without stepping on each other's files
- **Debugging with competing hypotheses**: Teammates test different theories in parallel and actively try to disprove each other
- **Cross-layer coordination**: Changes that span frontend, backend, and tests, each owned by a different teammate
- **Debate and consensus**: Multiple teammates argue different positions on an architectural decision, converging on the strongest approach
- **Large-scale inventory or classification**: Teammates divide a large dataset and process segments independently

For detailed prompt templates and 10+ real-world examples (including marketing, research, and non-dev use cases), see [Agent Teams Use Cases and Prompt Templates](/blog/agent-teams-use-cases).

### When to Skip Agent Teams

For sequential tasks, same-file edits, or work with tight dependencies, a single session or [subagent patterns](/blog/sub-agent-best-practices) are more cost-effective. If your workers don't need to communicate with each other, the overhead of an Agent Team isn't worth it. For independent, parallelizable changes that don't need coordination, [`/batch`](/blog/simplify-batch-commands) is a simpler alternative that handles worktree isolation automatically. Use async workflows for simple parallel execution without the collaboration layer. For common pitfalls and how to avoid them, see our [agent teams best practices](/blog/agent-teams-best-practices).

## Subagents vs Agent Teams: Choosing Your Approach

Both let you parallelize work, but they operate at different levels. The deciding question: do your workers need to communicate with each other?

| Feature | Subagents | Agent Teams |
| --- | --- | --- |
| **Context** | Own window, results summarized back to caller | Own window, fully independent |
| **Communication** | Report results back to the main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list with self-coordination |
| **Best for** | Focused tasks where only the result matters | Complex work requiring discussion and collaboration |
| **Token cost** | Lower: results summarized back to main context | Higher: each teammate is a separate Claude instance |
| **Use case examples** | Code review, file analysis, research lookups | Multi-component features, debates, cross-layer refactors |
| **Setup required** | None (built into Claude Code) | Environment variable to enable |
| **Communication pattern** | Hub-and-spoke (all through main agent) | Mesh (any teammate to any teammate) |

For more on subagent routing decisions, see [sub-agent best practices](/blog/sub-agent-best-practices).

## Step-by-Step: Your First Claude Code Agent Team

In practice, teammates typically spawn within 20-30 seconds and begin producing results within the first minute. A 3-teammate team uses roughly 3-4x the tokens of a single session doing the same work sequentially, but the time savings on complex tasks more than justify the cost.

### Step 1: Enable Agent Teams

Set the environment variable in your shell:

```
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Or add it to your `settings.json` for persistence across sessions:

```
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### Step 2: Describe Your Task and Team Structure

Tell Claude what you need in natural language. Be specific about roles and scope:

```
Create an agent team to review our authentication system. Spawn three teammates:
- Security reviewer: audit for vulnerabilities, check token handling
- Performance analyst: profile response times, identify bottlenecks
- Test coverage checker: verify edge cases, find untested paths
Have them share findings and coordinate through the task list.
```

### Step 3: Watch the Team Form and Steer

Claude creates a team lead (your main session), spawns the teammates, and distributes work through the shared task list. Claude can also propose creating a team on its own if it determines your task would benefit from parallel work. Either way, you stay in control.

Use keyboard shortcuts to monitor: **Shift+Up/Down** to select teammates, **Ctrl+T** for the task list, **Enter** to view a session, **Escape** to interrupt.

### Step 4: Clean Up

When work is done, shut down teammates and clean up:

```
Ask all teammates to shut down, then clean up the team.
```

Always use the lead to clean up. Shut down all teammates first, since the lead won't clean up while teammates are still running.

For detailed coverage of display modes, delegate mode, plan approval, hooks, task assignment, and token costs, see [Agent Teams Advanced Controls](/blog/agent-teams-controls).

## Architecture: How Claude Code Agent Teams Work

An Agent Team has four components working together:

| Component | Purpose |
| --- | --- |
| **Team Lead** | Your main Claude Code session. Creates the team, spawns teammates, assigns tasks, and synthesizes results. |
| **Teammates** | Separate Claude Code instances. Each gets its own context window and works on assigned tasks. |
| **Shared Task List** | Central work queue all agents can see. Tasks have states (pending, in progress, completed) and support dependencies. |
| **Mailbox** | Messaging system for communication between agents. |

Teams and their configuration live locally:

- Team config: `~/.claude/teams/{team-name}/config.json`
- Task list: `~/.claude/tasks/{team-name}/`

Each teammate has its own context window. When spawned, a teammate loads the same project context as a regular Claude Code session: your [CLAUDE.md](/blog/claude-md-mastery), MCP servers, and skills. It also receives the spawn prompt from the lead. The lead's conversation history does not carry over.

Communication works through automatic message delivery, idle notifications, the shared task list, direct messages (to one teammate), and broadcasts (to all teammates, used sparingly since costs scale with team size).

Teammates start with the lead's permission settings. You can change individual teammate modes after spawning, but not at spawn time.

For tips on optimizing your CLAUDE.md for agent teams, controlling team behavior, and managing token costs, see [Agent Teams Advanced Controls](/blog/agent-teams-controls).

## Dive Deeper

This hub article covers the fundamentals. Three companion guides go deeper into specific aspects:

- **[Advanced Controls](/blog/agent-teams-controls)**: Display modes, delegate mode, plan approval, quality gate hooks, task assignment, token cost management, and optimizing CLAUDE.md for teams
- **[Use Cases and Prompt Templates](/blog/agent-teams-use-cases)**: 10+ real-world scenarios with copy-paste prompts for code review, debugging, full-stack features, architecture decisions, marketing campaigns, and a progressive getting-started path
- **[Best Practices and Troubleshooting](/blog/agent-teams-best-practices)**: Battle-tested practices, plan mode behavior, troubleshooting guide, current limitations, and recent fixes from v2.1.33 through v2.1.45
- **[End-to-End Workflow](/blog/agent-teams-workflow)**: The complete 7-step pipeline from brain dump to production: planning, contract chains, wave execution, and post-build validation

For even faster interactive work while using agent teams, check out [Fast Mode](/blog/fast-mode) for 2.5x speed on Opus 4.6 responses.

## Managing Agent Coordination at Scale

As your agent teams grow in complexity, the coordination challenge shifts from "can I parallelize?" to "how do I manage the orchestration?" Three patterns help at scale:

1. **Standardized spawn prompt templates.** Create reusable prompt structures for your most common team configurations (review team, implementation team, research team). Each template defines roles, file boundaries, and success criteria so you don't rebuild from scratch each session. For the full workflow that these templates support, see the [end-to-end workflow guide](/blog/agent-teams-workflow).
2. **Permission presets.** Pre-approve common operations in your permission settings before spawning teammates. This eliminates the flood of permission prompts that can slow a new team to a crawl.
3. **CLAUDE.md as shared runtime context.** A well-structured CLAUDE.md with module boundaries, verification commands, and operational context reduces per-teammate exploration costs significantly. Three teammates reading a clear CLAUDE.md is far cheaper than three teammates exploring the codebase independently.

## The Multi-Agent Spectrum

Agent Teams sits at one end of a spectrum of multi-agent approaches in Claude Code. Understanding where each tool fits helps you choose the right one:

| Approach | Communication | Best For | Guide |
| --- | --- | --- | --- |
| **Single session** | N/A | Sequential, focused tasks | Context management |
| **Subagents (Task tool)** | Results only, back to main | Parallel focused work | Agent fundamentals |
| **Builder-validator pairs** | Structured handoff via tasks | Quality-gated implementation | [Team orchestration](/blog/team-orchestration) |
| **Agent Teams** | Full mesh, direct messaging | Collaborative exploration | This guide |

Combine these approaches based on your needs. Use Agent Teams for the collaborative exploration phase, then switch to [builder-validator patterns](/blog/team-orchestration) for the implementation phase where quality gates matter. For keeping context manageable across long-running team sessions, apply the same strategies you would with any multi-agent workflow.

Start with a review task this week. The overhead is low, and the capabilities will change how you think about complex development work.
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** adds a structured workflow on top of your coding agent: you approve the plan, helper agents build and test it slice by slice, and a fresh agent verifies the result against your request. The orchestration loop most agent setups end up writing by hand.

Compare it with plan modes: [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor plan mode](https://qualitylayer.dev/compare/cursor-plan-mode).

[Try QualityLayer →](https://qualitylayer.dev)

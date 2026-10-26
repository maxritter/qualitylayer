---
title: "Claude Code Agent Teams Best Practices & Troubleshooting"
description: "Battle-tested agent team practices. Troubleshooting guide, limitations, plan mode behavior, and fixes from v2.1.33 to v2.1.45."
slug: agent-teams-best-practices
date: 2026-02-18
authors:
  - max-ritter
tags:
  - guide
  - agents
---

Battle-tested agent team practices. Troubleshooting guide, limitations, plan mode behavior, and fixes from v2.1.33 to v2.1.45.

<!-- truncate -->

**Problem**: Your Claude Code agent team is running but burning through tokens without clear results. Teammates step on each other's files. The lead does work instead of coordinating. Tasks get stuck in "in progress" forever. These are solvable problems, and the patterns below come from real-world agent team usage across the community and months of iteration since the feature launched.

**Quick Win**: Use delegate mode (Shift+Tab) and give each teammate explicit file boundaries in the spawn prompt. These two changes alone eliminate the most common agent team failures.

**Note**: This is a companion guide to the [Agent Teams overview](/blog/agent-teams). Start there if you haven't set up your first team yet. For controls and configuration, see [Advanced Controls](/blog/agent-teams-controls).

## Give Teammates Enough Context

Include task-specific details in the spawn prompt. Teammates load project context automatically (CLAUDE.md, MCP servers, skills) but they don't inherit the lead's conversation history. Reference specific files, acceptance criteria, and constraints. The more specific the spawn prompt, the less back-and-forth the teammate needs.

A vague prompt like "review the auth module" forces the teammate to explore the codebase, figure out what matters, and guess at priorities. That exploration costs tokens and time. A specific prompt removes that ambiguity entirely:

```
Spawn a security reviewer teammate with the prompt: "Review the authentication
module at src/auth/ for security vulnerabilities. Focus on token handling, session
management, and input validation. The app uses JWT tokens stored in httpOnly cookies.
Report any issues with severity ratings."
```

The pattern is straightforward: what to do, where to do it, what to focus on, and what the deliverable looks like. Teammates that know their scope from the start finish faster and produce better results. For users coming from subagent patterns, the principle is the same but the stakes are higher since each teammate is a full context window.

## Size Tasks Appropriately

Too small and coordination overhead exceeds the benefit. Too large and teammates work too long without check-ins, increasing the risk of wasted effort. The sweet spot is self-contained units that produce a clear deliverable: a function, a test file, a review document.

Aim for 5-6 tasks per teammate. This keeps everyone productive and lets the lead reassign work if someone gets stuck. If the lead isn't creating enough tasks, ask it to split the work into smaller pieces. A teammate with one massive task has no natural check-in points. A teammate with 5-6 focused tasks reports progress after each one, giving you opportunities to steer.

## Avoid File Conflicts

Two teammates editing the same file leads to overwrites. This is the single most important rule for implementation tasks. Break the work so each teammate owns a different set of files. Define clear directory boundaries in your spawn prompt.

If your project structure doesn't naturally separate into independent directories, create the separation in your task decomposition. Instead of "refactor the API layer" split across teammates, assign "refactor the user endpoints in src/api/users/" to one teammate and "refactor the billing endpoints in src/api/billing/" to another. Explicit file ownership prevents silent overwrites that waste entire teammate sessions.

For projects where shared files are unavoidable, mark those files as "coordinate before editing" in your [CLAUDE.md](/blog/claude-md-mastery) and have the lead manage access through task sequencing.

## Use Delegate Mode by Default

Enable delegate mode (Shift+Tab) as soon as you start a team. Without it, the lead sometimes grabs tasks that teammates should handle, creating confusion about who owns what. Delegate mode restricts the lead to coordination-only tools so it focuses on orchestration rather than implementation. For setup details and configuration options, see the [delegate mode walkthrough](/blog/agent-teams-controls).

## Start with Research and Review

If you're new to agent teams, start with tasks that have clear boundaries and don't require writing code: reviewing a PR, researching a library, investigating a bug, or auditing a module for specific issues. These tasks show the value of parallel exploration without the coordination challenges that come with parallel implementation.

Research tasks are also forgiving. If a teammate goes down an unproductive path, you've lost some tokens but no code is affected. Implementation mistakes are harder to unwind, especially when multiple teammates have built on top of each other's work.

## Monitor and Steer Regularly

Check progress with **Ctrl+T** and redirect approaches that aren't working. Letting a team run unattended too long increases the risk of wasted effort, especially if one teammate goes down a path that isn't productive.

Agent teams work best as a supervised workflow. You're the project manager. The lead coordinates, but you make the strategic calls: when to redirect, when to spawn a replacement, and when to shut down a teammate that's stuck. Think of it like managing a distributed team of contractors. Regular check-ins catch problems before they compound.

## Keep Agent Teams Small

In our experience, 3-5 teammates is the practical sweet spot. More teammates means more coordination overhead, more token cost, and more potential for miscommunication. The lead's context fills faster when it's tracking 8 teammates versus 3. Communication costs scale with team size since every broadcast message hits every teammate's context window.

If your task genuinely needs more than 5 parallel workers, consider breaking it into phases instead. Run a team of 3 for the first phase, clean up, then run another team of 3 for the next phase. Sequential phases with smaller teams produce cleaner results than one massive team trying to coordinate everything at once.

## Agent Teams Plan Mode Behavior

Plan mode in agent teams has two important behaviors that are not obvious from the documentation.

**Plan mode is evaluated on every turn, not just once.** When a teammate runs in plan mode, it stays in plan mode for its entire lifetime. Every action it takes is filtered through plan mode's read-only constraints. This makes plan mode great for design-only roles and initial task shaping, but not for execution.

**An agent's mode stays fixed for its lifetime.** Once spawned, a teammate's mode (plan or default) cannot be changed. If you need a teammate to transition from planning to execution, spawn a new teammate in default mode and hand off the plan. Don't try to "switch" an existing teammate out of plan mode.

This has a practical implication for team design: use plan mode teammates for architecture and review roles where you want a read-only perspective. Use default mode teammates for any role that needs to write code or modify files. If you want a plan-then-implement workflow, use the [plan approval feature](/blog/agent-teams-controls) instead, which lets a default-mode teammate plan first and implement after approval.

## The Self-Reporting Pattern

With clear rules in your CLAUDE.md, teammates self-report exactly what they did without lead intervention. When a teammate finishes a cleanup task with proper CLAUDE.md context, you get reports like:

> "Removed 27 console.log across 3 files. Kept all 12 console.error and 2 console.warn in component-page.js. Verified zero console.log remaining in my assigned files."

No lead intervention needed. Clear rules in, clear reports out.

This pattern emerges naturally when your CLAUDE.md has specific verification criteria. Instead of "clean up logging," the teammate knows from your CLAUDE.md that "verified" means running grep for remaining instances and checking that error-level logging is preserved. For details on structuring your CLAUDE.md for agent teams, see [CLAUDE.md mastery](/blog/claude-md-mastery) and the CLAUDE.md optimization section in [Advanced Controls](/blog/agent-teams-controls).

## Troubleshooting Agent Team Issues

Common issues and their solutions, drawn from community reports and release notes:

| Issue | Solution |
| --- | --- |
| Teammates not appearing | Check Shift+Down to cycle through active teammates. Verify task complexity warrants a team. For split-pane mode, check tmux/iTerm2 setup. |
| Too many permission prompts | Pre-approve common operations in your permission settings before spawning teammates. Each teammate inherits the lead's permissions, so configuring once covers the whole team. |
| Teammates stopping on errors | Give additional instructions directly (Shift+Up/Down to select, then type). Or spawn a replacement teammate to continue the work. |
| Lead shuts down before work is done | Tell the lead to keep going. Say "Wait for your teammates to complete their tasks before proceeding." |
| Orphaned tmux sessions | Run `tmux ls` to list sessions, then `tmux kill-session -t <session-name>` to clean up. |
| Teammates stepping on each other's files | Define explicit file boundaries in the spawn prompt. Use directory-level ownership. See the "Avoid File Conflicts" section above. |
| Task status looks stuck | Teammates sometimes forget to mark tasks complete. Check manually with Ctrl+T and prompt the teammate to update status. |
| Teammates on Bedrock/Vertex/Foundry fail | Update to v2.1.45+. Earlier versions had issues with model identifiers and missing API provider environment variables for tmux teammates. |
| Crash when toggling agent teams setting | Update to v2.1.34+. Fixed a crash when the agent teams setting changed between renders. |
| tmux teammates can't send/receive messages | Update to v2.1.33+. Fixed agent teammate sessions in tmux to send and receive messages correctly. |

If your issue isn't listed here, check which Claude Code version you're running. Many early pain points were resolved in the v2.1.33 through v2.1.45 releases.

## Current Agent Team Limitations

Agent Teams is experimental. These constraints are worth knowing before you commit to a team-based workflow:

- **No session resumption**: In-process teammates are not restored when using `/resume` or `/rewind`. After resuming, the lead may try to message teammates that no longer exist. Tell it to spawn replacements.
- **Task status can lag**: Teammates sometimes forget to mark tasks as completed, blocking dependent work. Check manually if something looks stuck.
- **Slow shutdown**: Teammates finish their current request or tool call before shutting down. This can take time if a teammate is mid-implementation.
- **One team per session**: A lead manages one team at a time. Clean up the current team before starting another.
- **No nested teams**: Teammates cannot spawn their own teams. Only the lead manages the team hierarchy.
- **Fixed lead**: The session that creates the team stays the lead for its lifetime. You cannot promote a teammate or transfer leadership.
- **Permissions set at spawn**: All teammates start with the lead's permission settings. You can change individual modes after spawning, but not at spawn time.
- **Split panes require tmux or iTerm2**: Split-pane mode is not supported in VS Code's integrated terminal, Windows Terminal, or Ghostty.

Being transparent about these limitations matters. Agent Teams is a powerful tool with rough edges. The developers who learn the workarounds now will be ready when Anthropic polishes the feature.

## Recent Fixes and Improvements

Since the initial Agent Teams release in v2.1.32, Anthropic has shipped several important fixes. If you tried agent teams early and hit issues, check whether your problem was resolved:

**v2.1.33**:

- Added TeammateIdle and TaskCompleted hooks for quality gate enforcement
- Added `Task(agent_type)` spawn restrictions to control which subagent types can be spawned
- Added persistent `memory` field for agents with user, project, and local scopes
- Fixed tmux teammate sessions to correctly send and receive messages
- Fixed plan mode warnings in team contexts

**v2.1.34**:

- Fixed crash when agent teams setting changed between renders

**v2.1.41**:

- Fixed wrong model identifier for teammates on Bedrock/Vertex/Foundry
- Added `speed` attribute to OTel events for fast mode observability

**v2.1.45**:

- Fixed teammates failing on Bedrock/Vertex/Foundry by propagating API provider environment variables to tmux sessions
- Fixed skills invoked by subagents incorrectly appearing in main session after compaction

If you're experiencing issues, update Claude Code to the latest version. The team ships fixes regularly and agent teams is under active development.

## What to Read Next

This guide covers the operational patterns. For the full picture:

- **[Agent Teams overview](/blog/agent-teams)** for the feature fundamentals and architecture
- **[Advanced Controls](/blog/agent-teams-controls)** for display modes, delegate mode, hooks, and token cost management
- **[Use Cases and Prompt Templates](/blog/agent-teams-use-cases)** for copy-paste prompts across 10+ real-world scenarios
- **[End-to-End Workflow](/blog/agent-teams-workflow)** for the complete 7-step pipeline from brain dump to validated production code
- **[Sub-agent best practices](/blog/sub-agent-best-practices)** for when a full team is overkill and focused subagents are the better fit
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** adds a structured workflow on top of your coding agent: you approve the plan, helper agents build and test it slice by slice, and a fresh agent verifies the result against your request. The orchestration loop most agent setups end up writing by hand.

Compare it with plan modes: [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor plan mode](https://qualitylayer.dev/compare/cursor-plan-mode).

[Try QualityLayer →](https://qualitylayer.dev)

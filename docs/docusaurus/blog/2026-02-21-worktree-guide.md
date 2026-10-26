---
title: "Claude Code Worktrees: Parallel Sessions Without Conflicts"
description: "Use Claude Code git worktree support to run parallel AI sessions. Guide to the --worktree flag, subagent isolation, and Desktop mode."
slug: worktree-guide
date: 2026-02-21
authors:
  - max-ritter
tags:
  - guide
  - development
---

Use Claude Code git worktree support to run parallel AI sessions. Guide to the --worktree flag, subagent isolation, and Desktop mode.

<!-- truncate -->

**Problem**: You're running a Claude Code session on a feature branch and need to fix a production bug. You either stash your work, lose context, or open a second terminal and fight merge conflicts when both sessions edit the same files.

**Quick Win**: Start a new Claude Code session in its own worktree:

```
claude --worktree bugfix-123
```

This creates an isolated working directory at `.claude/worktrees/bugfix-123/` with its own branch `worktree-bugfix-123`. Your original session stays untouched. No stashing. No conflicts. Two fully independent Claude sessions running in parallel.

## Why Worktrees Change Everything

If you've used Claude Code's [sub-agent patterns](/blog/sub-agent-best-practices) or background agents, you've probably hit the wall: multiple agents editing the same files at the same time. One agent writes to `src/auth.ts` while another rewrites the same module. The result is merge conflicts, half-applied changes, or worse.

Git worktrees solve this at the filesystem level. Each worktree is a separate checkout of your repository with its own branch, its own working directory, and its own index. Claude Code v2.1.50 adds first-class support for creating, managing, and cleaning up worktrees directly from the CLI, Desktop app, and even inside custom agents.

## The CLI: `--worktree` Flag

The simplest way to use worktrees is the `--worktree` flag when launching Claude Code.

### Named worktrees

```
# Start Claude in a named worktree
claude --worktree feature-auth
 
# Creates:
# .claude/worktrees/feature-auth/  (working directory)
# Branch: worktree-feature-auth    (branched from default remote branch)
```

Each worktree gets its own directory under `.claude/worktrees/` and a dedicated branch. You can run as many as your disk can hold.

### Auto-named worktrees

```
# Let Claude generate a name
claude --worktree
```

Useful for quick throwaway sessions where you don't care about the branch name.

### Multiple parallel sessions

```
# Terminal 1: working on auth
claude --worktree feature-auth
 
# Terminal 2: fixing a bug
claude --worktree bugfix-123
 
# Terminal 3: exploring a refactor
claude --worktree experiment-new-router
```

Three isolated sessions, three branches, zero conflicts. Each session has full access to your codebase history but operates on completely separate file trees.

### Mid-session worktree creation

You don't need the flag at launch. During any session, just ask:

```
You: work in a worktree
Claude: I'll create an isolated worktree for this session...
```

Claude creates the worktree and switches your session into it. This is useful when you realize mid-conversation that your changes should be isolated.

## Desktop App: Automatic Isolation

The Claude Code Desktop app takes worktrees further with automatic isolation for every new session.

Each session gets its own worktree stored in `.claude/worktrees/` by default. You can customize this location in Desktop Settings along with a branch prefix for organizing Claude-created branches. When you're done with a session, use the archive icon to remove the worktree and its branch.

This means every Desktop session is safe by default. No accidental overwrites between sessions, no coordination needed.

## Subagent Worktree Isolation

This is where worktrees become genuinely powerful. When Claude spawns sub-agents for task distribution, each sub-agent can get its own worktree.

### Asking Claude to isolate agents

The simplest approach:

```
You: Use worktrees for your agents when doing this refactor
```

Claude will spawn each sub-agent in its own worktree. When agents finish, worktrees with no changes are automatically cleaned up. Worktrees with changes persist for your review.

### Why this matters for parallel execution

Without worktree isolation, parallel sub-agents are limited to reading files or writing to non-overlapping paths. That's a fragile constraint. One agent drifting into another's file territory causes silent conflicts.

With worktree isolation, each agent has the entire codebase to itself. Agent A can rewrite `src/auth.ts` while Agent B rewrites the same file with a different approach. You review both branches and pick the winner (or merge them).

This pattern is especially valuable for batched code migrations. Need to update 50 files from one API pattern to another? Spawn 5 agents, each handling 10 files in their own worktree. They all run in parallel without stepping on each other. The built-in [`/batch` command](/blog/simplify-batch-commands) uses exactly this pattern, spinning up worktree-isolated agents to run parallel codebase migrations with a single prompt.

## Custom Agents with Built-In Isolation

If you build custom agents in `.claude/agents/`, you can configure them to always use worktree isolation:

```
---
name: refactor-agent
description: Agent that performs isolated refactoring work
isolation: worktree
---
You are a refactoring specialist. Analyze the target code,
plan the refactor, and implement changes.
```

The `isolation: worktree` frontmatter tells Claude to create a fresh worktree every time this agent runs. The agent works in complete isolation, and the worktree auto-cleans if it makes no changes.

## Non-Git VCS Support

If your team uses Mercurial, Perforce, or SVN instead of Git, worktree mode still works through custom hooks. Configure `WorktreeCreate` and `WorktreeRemove` hooks in your settings to replace the default git behavior with your VCS-specific isolation logic.

When these hooks are configured, the `--worktree` flag and in-session worktree requests will call your hooks instead of running git commands. The rest of the workflow stays the same.

## Cleanup and Housekeeping

Worktree cleanup depends on whether the session made changes:

- **No changes**: The worktree and its branch are automatically removed when the session ends
- **Changes exist**: Claude prompts you to keep or remove the worktree

Add `.claude/worktrees/` to your `.gitignore` to keep worktree directories out of version control:

```
echo ".claude/worktrees/" >> .gitignore
```

If you accumulate stale worktrees, you can list and prune them with standard git commands:

```
git worktree list
git worktree prune
```

## When to Use Worktrees

| Scenario | Use Worktree? | Why |
| --- | --- | --- |
| Quick single-file fix | No | Overhead isn't worth it |
| Feature work while fixing a bug | Yes | Keeps feature and bugfix branches clean |
| Multi-agent parallel execution | Yes | Prevents file conflicts between agents |
| Code migration across many files | Yes | Split work across isolated agents |
| Exploring experimental approaches | Yes | Throwaway worktrees with auto-cleanup |
| Single focused session | No | Regular checkout is fine |

The rule of thumb: if you'd normally create a separate branch to avoid conflicts, use a worktree instead. You get the branch isolation plus a separate working directory.

## Next Steps

- Use [Remote Control](/blog/remote-control-guide) to manage worktree sessions from your phone
- Set up version control workflows for commits, branches, and PRs
- Learn [parallel and sequential patterns](/blog/sub-agent-best-practices) for effective agent dispatch
- Run background agents to keep building while agents work
- Build custom agents with built-in worktree isolation
- Master [multi-agent orchestration](/blog/agent-teams) for complex projects
- Understand the terminal as main thread to coordinate it all
- Review [sandboxing and security isolation](/blog/sandboxing-guide) for safe agent execution

Worktrees turn Claude Code from a single-threaded assistant into a parallel development environment. Launch isolated sessions, dispatch isolated agents, and merge results when you're ready.
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** is a planning-first workflow for any coding agent, including Claude Code, Codex, Pi and OpenCode. You approve the plan in the Cockpit before any code is written, helper agents build it in small tested slices, and an AI that did not write the code checks the result against what you asked for.

Running several agents in parallel? See [QualityLayer vs Claude Squad](https://qualitylayer.dev/compare/claude-squad) and [QualityLayer vs Conductor](https://qualitylayer.dev/compare/conductor).

[Try QualityLayer →](https://qualitylayer.dev)

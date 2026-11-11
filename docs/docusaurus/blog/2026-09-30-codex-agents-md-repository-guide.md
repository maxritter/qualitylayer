---
title: "Codex AGENTS.md: a repository guide that helps the next task"
description: "Write concise Codex repository instructions covering structure, verification and working agreements without duplicating changing implementation details."
slug: codex-agents-md-repository-guide
date: 2026-09-30
authors: [max-ritter]
tags: ["codex","guide"]
image: https://qualitylayer.dev/og.png
---

A useful AGENTS.md helps an agent find the right code and run the right checks. It should remain useful after the current conversation ends.

<!-- truncate -->

Codex reads repository instructions along the path from the project root to its working directory. OpenAI documents the precedence of AGENTS.override.md and AGENTS.md, including more specific directory instructions. [Official AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Record what a new session needs

Start with a quick map: which directory owns each responsibility, how to run the application and which command verifies a change.

For example:

```markdown
# Repository guide

- Request handlers live in src/server.
- Shared domain rules live in src/core.
- Run npm run check for types and lint.
- Run npm test for behavioral coverage.
- Preserve unrelated edits in the working tree.
- Describe the check you ran and any remaining limitation.
```

This is an illustrative file. Replace its commands and paths with the repository's actual ones.

A rule that names a nonexistent command adds friction every time the agent uses it. Verify the commands before recording them.

## Keep facts close to their owner

Repository-wide instructions should explain the common path. A directory with a different test runner or deployment model can carry its own specific guidance.

That arrangement avoids forcing every task to read details about every subsystem. It also gives the team a clear place to maintain a rule when that subsystem changes.

Do not repeat a generated configuration as if it were the source. If a tool owns a configuration file, point to its inputs and required verification instead.

## Separate stable guidance from a task plan

AGENTS.md is a poor place for the current task's open questions, abandoned options and progress counter. Those records belong with the task.

A durable plan should say which decisions were approved, what the builder must deliver and how the result will be checked. QualityLayer keeps that material in the task documents, with [Frame](/docs/steps/plan), [Design](/docs/steps/plan) and [Outline](/docs/steps/plan) serving different purposes.

The repository guide can explain where those documents are found without copying them into global instructions.

## Review rules for their effect

Ask what a line changes about the next task. Does it identify an owner, preserve a boundary or name a check? If it only repeats a general wish for good code, it may not help a session decide what to do.

Keep an instruction when it carries concrete information the agent otherwise lacks. Update it when the repository changes.

## Check what loaded

When behavior seems inconsistent, ask the agent to identify the instruction sources it used. Compare that list with the directory where the session started.

Use the [official precedence rules](https://learn.chatgpt.com/docs/agent-configuration/agents-md) to investigate the result. Avoid solving an instruction problem by adding the same paragraph to several files.

Related: [Skills and MCP](/blog/codex-skills-and-mcp) and [parallel worktrees](/blog/codex-parallel-worktrees).

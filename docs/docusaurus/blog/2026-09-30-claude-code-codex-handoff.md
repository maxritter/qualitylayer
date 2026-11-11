---
title: "Plan with Claude Code, build with Codex, review the result"
description: "Move an approved change between Claude Code and Codex with durable documents, a task-specific prompt and independent review checkpoints."
slug: claude-code-codex-handoff
date: 2026-09-30
authors: [max-ritter]
tags: ["codex","workflow"]
image: https://qualitylayer.dev/og.png
---

A plan can outlive the agent session that created it. That makes it possible to plan in Claude Code, build in Codex and review the result without carrying the whole chat between them.

<!-- truncate -->

Codex CLI can inspect a local repository, edit files and run the tools installed there. Its model, effort and permissions remain part of that runtime's configuration. [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli).

## Agree before switching

The builder needs an approved outcome and enough detail to implement it. Resolve important behavior, compatibility and interface decisions before handing the work over.

The plan should identify working slices, their task boundaries and the checks that show each slice is complete. If those choices remain implicit in the planning conversation, the new agent may reasonably interpret them differently.

QualityLayer separates the readable overview from the technical detail. [Design](/docs/steps/plan) records the choices; [Outline](/docs/steps/plan) prepares the task cards and acceptance checks.

## Start the chosen builder

Open Handoff and select Codex. Inspect the recommended model, effort, run mode and starting session. Follow the launch instructions shown for the selected setup.

Copy the build prompt from that task. It identifies the approved documents and the next human stop. A fresh session then starts from those documents.

The same flow works in the other direction. The model that plans does not have to be the model that builds.

## Keep the task identity explicit

Multiple terminals can have different tasks in the same repository. A handoff should name which plan to continue; opening a new session should not silently adopt whichever task another terminal used last.

QualityLayer binds active agent sessions to their tasks. Its generated handoff provides an explicit continuation request. That keeps the transition deliberate even when several sessions are active.

If a message arrives from another session, treat it as information about that work. It does not replace the owner's review decision.

## Add another perspective where it helps

With both agents installed, QualityLayer can configure Codex reviewing Claude Code or the reverse before design approval, before outline approval and after the build. Each point and direction has its own model and effort choice.

Those reviews are opt-in advice. The producing agent considers the findings, while the owner still decides at the gate. See [independent reviews](/docs/reference/settings#second-opinion) for the settings.

## Review working software

A builder can follow the plan and still misunderstand an interaction. Try the finished slice on the running program, then read the [verification evidence](/docs/steps/verify) before final approval.

The handoff is useful when it preserves the decisions and makes the result easier to assess. It should not require you to reconstruct a second agent's private conversation.

Start with [your first QualityLayer task](/docs/first-task), or read the [workflow overview](/docs#the-three-steps).

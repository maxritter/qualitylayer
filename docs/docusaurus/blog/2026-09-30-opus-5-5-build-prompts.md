---
title: "Opus 5.5 build prompts: give the agent a clear stopping point"
description: "Write an Opus 5.5 coding prompt with an approved plan, observable checks and a human checkpoint instead of vague instructions to keep thinking."
slug: opus-5-5-build-prompts
date: 2026-09-30
authors: [max-ritter]
tags: ["guide","workflow"]
image: https://qualitylayer.dev/og.png
---

A build prompt should tell the agent what to implement, how to check it and when to return control. Those boundaries matter even when the model can work for a long time.

<!-- truncate -->

For Opus 5.5, start by checking the runtime's model and effort controls. Anthropic documents an explicit effort setting and a medium API default; repeated instructions to reason harder are a poor substitute for knowing the configuration. [Migration guidance](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

## Give the builder a contract

A broad request such as “finish the reporting feature” leaves several decisions open. Does it include permissions, export formats, existing filters and mobile behavior? The agent can fill those gaps, but the result may differ from what you wanted.

A reviewed plan should settle those questions before implementation. The build prompt can then stay short:

```text
Build the approved reporting change.
Use the recorded behavior and task outline.
Verify the CSV against the agreed cases.
Stop at the first running checkpoint for my review.
```

This example is a prompt structure, not a universal command. In QualityLayer, copy the generated prompt from [Handoff](/docs/steps/implement#start-implement), because it identifies the task and its actual checkpoints.

## Specify evidence

For a CSV export, useful evidence might include:

- a test showing that the selected filters reach the export;
- an example output with the expected headers;
- an empty-result case;
- a check of the running interface that starts the download.

Tell the agent what the evidence must establish. Asking it to “verify thoroughly” leaves the meaning of verification undefined.

Use the [definition of done](/docs/steps/plan) to decide the checks. More output is not automatically better evidence.

## Stop at a decision

A stopping point should name an event you can observe: a slice is running, a design is ready or final verification is complete.

“Keep going until perfect” supplies no such event. It can turn a useful correction into another round of speculative work. A checkpoint instead gives you a specific result to try and a decision to make.

The same principle applies when an agent is blocked. Ask for the failed command, observed result and remaining question. A clear report can unblock the work faster than another unsupervised attempt.

## Preserve a fresh start

The builder needs the approved decisions, not every abandoned planning discussion. Start a new or cleared session when the plan is complete, and let the documents carry the context.

QualityLayer's current Claude Code goal prompt reads its workflow through `qualitylayer guide`. It does not require a separate slash-skill setup submission. The Handoff tab also supplies the launch steps for your selected model and effort.

## Review the result

A precise prompt improves the starting conditions. It does not prove the implementation is correct. [Verify](/docs/steps/verify) still checks the running change, and [Review](/docs/steps/verify#items) still returns the decision to you.

Related: [evaluating Opus 5.5](/blog/claude-opus-5-5-coding) and [moving between Claude Code and Codex](/blog/claude-code-codex-handoff).

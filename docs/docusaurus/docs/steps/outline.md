---
title: Outline
description: "See how your agent will build the approved Plan: the slices, their tasks and the scenarios that prove it."
---

![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-light.svg)
![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-dark.svg)

The build session reads Discuss, the approved Plan and its build notes, then outlines the slices, tasks and scenarios. It continues through Implement and Verify; **no further approval is needed until Review**.

## What is in it {#what-the-agent-does}

| Part | What it holds |
| --- | --- |
| **Summary** | The build's order in three lines |
| **Slices** | Pieces that each work end to end, thinnest first; each opens to its tasks |
| **Scenarios** | The end-to-end runs in order, with the **Done means** points each proves and the Plan's acceptance test last |
| **Decided while outlining** | Program-level calls, one line each with its reason |
| **Technical** | The program design the Plan left open |

Open a slice for its tasks, then a task for its card. Pick a **Done means** number to see which scenarios prove it. Each task's files and test first, each slice's files and each scenario's steps are in the agents' file, listed under **For agents** in the Reader.

For a bug, the Outline keeps reproduction before the root-cause repair and includes the named regression checks. It uses the slices the repair needs; the final project checks run in Verify.

Cards name source files. Additional files need no amendment. Check output and pictures stay in the task's records.

## What you do {#what-you-do}

[Start the build](implement.md#start-implement). You can follow progress or comment on a slice. Missing human-only prerequisites never count as passed while available work continues; they create no new approval here.

Next: [Implement](implement.md).

---
title: Outline
description: See where the approved Plan changes the code and how your agent will build it.
---

![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-light.svg)
![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-dark.svg)

The build session reads Discuss, the approved Plan and its build notes, then outlines the code areas, tasks and tests. It continues through Implement and Verify; **no further approval is needed until Review**.

## What is in it {#what-the-agent-does}

| Part | What it holds |
| --- | --- |
| **Where the change lands** | Code areas, their files, planned slices and risks |
| **Decided inside the code** | The decisions the build session made that the Plan left open |
| **Proof** | The scenario that proves each **Done means** point |
| **Slices** | Pieces that each work end to end, thinnest first, with the test to write first |
| **Commands** | Every command the build will run. A push or deploy needs the Plan's permission |

Open a code area for its file changes and decisions. Each **Done means** point links to its proof scenario. Slices and task cards appear on [Implement](implement.md).

For a bug, the Outline keeps reproduction before the root-cause repair and includes the named regression checks. It uses the slices the repair needs; the final project checks run in Verify.

Cards name source files. Additional files need no amendment and are listed in Review. Check output and pictures stay in the task's records.

## What you do {#what-you-do}

[Start the build](implement.md#start-implement). You can follow progress or comment on a slice. Human-only prerequisites that are missing stay unverified for Review while available work continues. They create no new approval here.

Next: [Implement](implement.md).

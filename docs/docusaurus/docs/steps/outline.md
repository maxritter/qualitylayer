---
title: Outline
description: See where the approved Plan changes the code and how your agent will build it.
---

![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-light.svg)
![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-dark.svg)

The Outline maps the approved Plan to code areas, tasks and tests. Your agent writes it and continues through Implement and Verify; **no further approval is needed until Review**.

## What is in it {#what-the-agent-does}

| Part | What it holds |
| --- | --- |
| **Where the change lands** | Code areas, their files, planned slices and risks |
| **Decided inside the code** | The decisions the build session made that the Plan left open |
| **Proof** | The scenario that proves each **Done means** point |
| **Slices** | Pieces that each work end to end, thinnest first, with the test to write first |
| **Commands** | Every command the build will run. A push or deploy needs the Plan's permission |

The **Outline** page opens on the areas of the code. Open an area for what changes in each file and the decisions made for it. Each **Done means** point links to the scenario that proves it. The slices and their task cards are listed once, on [Implement](implement.md).

For a bug, the Outline keeps reproduction before the root-cause repair and includes the named regression checks. It uses the slices the repair needs; the final project checks run in Verify.

The build session works through the cards in this order. Cards name source files; a file outside the cards needs no amendment, and Review lists it. Check output and pictures stay in the task’s records.

## What you do {#what-you-do}

[Start the build](implement.md#start-implement). You can follow progress or comment on a slice. Human-only prerequisites that are missing stay unverified for Review while available work continues. They create no new approval here.

Next: [Implement](implement.md).

---
title: Outline
description: The Outline shows where the change lands in the code before any of it is written. The build session writes it from the approved Plan; a small task can have it ready earlier. You do not approve it again.
---

![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-light.svg)
![The workflow, with Outline highlighted](pathname:///img/diagrams/track-outline-dark.svg)

The Plan says what changes; the Outline says where in the code it lands and how it is built. The build session writes it from the approved Plan, then continues through Implement and Verify until human Review. **You do not approve the Outline again.**

## What is in it {#what-the-agent-does}

| Part | What it holds |
| --- | --- |
| **Where the change lands** | Each area of the code the build adds to or changes, with its new and changed files, the slices that change it and whether it is risky |
| **Decided inside the code** | The decisions the build session made that the Plan left open |
| **Proof** | The scenario that proves each **Done means** point |
| **Slices** | Pieces that each work end to end, thinnest first, with the test to write first |
| **Commands** | Every command the build will run. A push or deploy needs the Plan's permission |

The page, **Where it will change**, opens on the areas of the code. Open an area for what changes in each file and the decisions made for it. Each **Done means** point links to the scenario that proves it. The slices and their task cards are listed once, on [Implement](implement.md).

For a bug, the Outline keeps reproduction before the root-cause repair and includes the named regression checks. It uses the slices the repair needs; the final project checks run in Verify.

The build session works through the cards in this order. Cards name source files; a file outside the cards needs no amendment, and Review lists it. Check output and pictures stay in the task’s records.

## What you do {#what-you-do}

[Start the build](implement.md#start-implement). You can follow progress or comment on a slice. Human-only prerequisites that are missing stay unverified for Review while available work continues. They create no new approval here.

Next: [Implement](implement.md).

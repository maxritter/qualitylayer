---
title: Plan
description: "Approve the proposed change, design decisions and checks before the build."
---

![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-light.svg)
![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-dark.svg)

The **Plan** page is the document you approve before the build. The summary, diagrams, interface and acceptance test come first. A small change keeps it brief.

![The Plan in the App: its one open decision with both paths drawn, under Give feedback and Approve Plan](pathname:///img/app/plan-light.webp)
![The Plan in the App: its one open decision with both paths drawn, under Give feedback and Approve Plan](pathname:///img/app/plan-dark.webp)

*Example task in a fictional project.*

## What you read {#items}

| Part | What it tells you |
| --- | --- |
| **Summary** | The change in a few lines, with the size of the build and what reviewed it |
| **Diagrams** | Up to three, in tabs: before and after, a flow, a sequence or the architecture. Open one to zoom or enlarge it |
| **Interface** | One tab per screen: a clickable artifact ([Artifacts](../artifacts.md)), with **Open** for a full view |
| **Acceptance test** | The deciding test, a tab per step with the screen or output it shows, and how it will run. [Review](review.md) shows the same steps as they ran |
| **What changes** and **Rollout and operations** | The files that change, one row each, and what ships or needs attention |
| **Decisions made for you**, **Assumptions**, **Not doing** and **Prerequisites** | Your agent's smaller choices with reasons, what the Plan takes for granted, what stays untouched, and what must be ready first, such as a login |

Engineering detail (code, data and interfaces, contracts, decisions and checks) folds below. **Done means and scope** repeat Discuss in the Reader.

| Read or share | Where |
| --- | --- |
| **The specification** | `03-plan.md`, written for people. **What we agreed** repeats Discuss's **Done means** and **Not doing**; artifact pictures stay linked |
| **Build notes** | `agents/03-plan.md`, listed under **For agents** in the Reader: code to imitate, how to start and test, pitfalls, rejected approaches and the risks with the test that guards each. They never change what you approve |
| **A portable copy** | `qualitylayer plan export --out <folder>` exports the Plan, `01-discuss.md` and pictures for readers without QualityLayer |

The Product level uses plainer words ([two levels](../intro.md#two-levels)).

## Approve or give feedback {#answering}

A choice only you can make appears as **Your call** beside its subject. The header counts open calls, and answers reach your agent immediately. The planning agent clears every risk and doubt first, by asking you or settling it itself; the Plan then marks nothing as risky or open.

1. Read the complete Plan.
2. Pin comments, or press **Give feedback**. Your agent revises; the diff shows what changed.
3. Once every call is answered, choose **Approve and build here**. The planning session keeps its history and settings and builds after its current turn. **Choose where to build**, under the arrow, opens the build card instead. Both approve the Plan, **Done means**, the artifacts and the acceptance test together.

For a waiting terminal planner, **Build in &lt;agent&gt; · terminal** continues that conversation. Otherwise choose to build here, compact first, or use another session with a prepared prompt.

Answering a question does not approve the Plan. Approve in the App, also when the agent works in your terminal, or give an explicit approval through your agent.

![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-light.svg)
![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-dark.svg)

### Comment on a diagram {#diagrams}

Click any part of a diagram, a screen or a passage to pin a comment; your agent reads it when it next checks the task. Teammates can comment too ([Plan reviews](../team/plans.md)).

## Before it reaches you {#before-it-reaches-you}

Your agent rereads the Plan as a reviewer would. Risky Plans also get a [second opinion when enabled](../reference/settings.md#second-opinion). Required reviews keep **Approve Plan** blocked with an amber reason until they finish.

## Start from an existing plan {#existing-plan}

**Existing plan**, or **Saved plan** from a Chat, keeps the original as `original-plan.md` and marks Discuss and Research **Not run**. Your agent maps it into a short execution agreement, shown instead of the sections above. Settle any **Your call**, then **Approve Plan**.

Next: [Start Implement](implement.md#start-implement). The build session writes the [Outline](outline.md), then builds it.

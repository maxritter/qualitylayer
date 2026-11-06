---
title: Plan
description: "Approve the proposed change, design decisions and checks before the build."
---

![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-light.svg)
![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-dark.svg)

The **Plan** page is the document you approve before the build. The proposed change, key decisions and open issues come first. A small change keeps it brief.

![The Plan in the App: its one open decision with both paths drawn, under Give feedback and Approve Plan](pathname:///img/app/plan-light.webp)
![The Plan in the App: its one open decision with both paths drawn, under Give feedback and Approve Plan](pathname:///img/app/plan-dark.webp)

*Example task in a fictional project.*

## What you read {#items}

| Part | What it tells you |
| --- | --- |
| **Summary** | The change in a few lines, with the size of the build, whether it is risky and what reviewed it |
| **Done means** | The results from [Discuss](discuss.md), and how each will be checked |
| **The artifact** | A wireframe or finished artifact for anything people see ([Artifacts](../artifacts.md)) |
| **Today and after the change** | A view of the change when it makes the proposal clearer; a picture of how code connects is drawn as a change map |
| **Engineering decisions** | The consequential choices and their reasons, with a diagram where it helps; more than six fold to one row each |
| **Not doing** | What stays untouched |
| **Decisions made for you** | Your agent's smaller choices, with reasons |
| **Assumptions** | What the Plan takes for granted |
| **Before the build** | What must be ready first, such as a login |

The artifact stays visible; risks, findings and contracts fold to one-line summaries.

| Read or share | Where |
| --- | --- |
| **The specification** | `03-plan.md`, written for people. **What we agreed** repeats Discuss's **Done means** and **Not doing**; artifact pictures stay linked |
| **Build notes** | `agents/03-plan.md`, folded under **Build context** in Files. They never change what you approve |
| **A portable copy** | `qualitylayer plan export --out <folder>` exports the Plan, `01-discuss.md` and pictures for readers without QualityLayer |

The Product level uses plainer words ([two levels](../intro.md#two-levels)).

### What to read first {#read-first}

**Look here** highlights unresolved actions that need you. Open the decisions, assumptions and review details for their full context.

## Approve or give feedback {#answering}

A new choice revealed by the design appears as **Your call** beside its subject. The header counts open calls, and answers reach your agent immediately. The planning agent handles technical-review findings; only unresolved human choices come to you.

1. Read the complete Plan.
2. Pin comments, or press **Give feedback**. Your agent revises; the diff shows what changed.
3. Once every call is answered, choose **Approve and build here**. The planning session keeps its history and settings and builds after its current turn. **Choose where to build**, under the arrow, opens the build card instead. Both approve the Plan, **Done means** and artifact together.

For a waiting terminal planner, **Build in &lt;agent&gt; · terminal** continues that conversation. Otherwise choose to build here, compact first, or use another session with a prepared prompt.

Answering a question does not approve the Plan. Approve in the App, also when the agent works in your terminal, or give an explicit approval through your agent.

![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-light.svg)
![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-dark.svg)

### Comment on a diagram {#diagrams}

Click any part of a diagram, a change map's card or a passage to pin a comment; your agent reads it when it next checks the task. Teammates can comment too ([Plan reviews](../team/plans.md)).

## Before it reaches you {#before-it-reaches-you}

Your agent rereads the Plan as a reviewer would. Risky Plans also get a [second opinion when enabled](../reference/settings.md#second-opinion). Required reviews keep **Approve Plan** blocked with an amber reason until they finish.

## Start from an existing plan {#existing-plan}

**Existing plan**, or **Saved plan** from a Chat, keeps the original as `original-plan.md` and marks Discuss and Research **Not run**. Your agent maps it into a short execution agreement, shown instead of the sections above. Settle any **Your call**, then **Approve Plan**.

Next: [Start Implement](implement.md#start-implement). The build session writes the [Outline](outline.md), then builds it.

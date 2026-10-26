---
title: Plan
description: "The one document you approve before any code: what it rests on, the artifact and its decisions, and how you will know it works."
---

![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-light.svg)
![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-dark.svg)

The Plan is the document you approve before the workflow builds. It puts the proposed change, key decisions and open issues first. A small change keeps this brief; larger changes include the design detail you need to review.

![The Plan in the App, with Approve Plan and Give feedback at the top right](pathname:///img/app/plan-light.webp)
![The Plan in the App, with Approve Plan and Give feedback at the top right](pathname:///img/app/plan-dark.webp)

*Example task in a fictional project.*

## Start from an existing plan {#existing-plan}

**Plan with QualityLayer** is the default. It uses Discuss and Research to prepare the Plan below.

Choose **Existing plan** in New task, or **Saved plan** when starting the workflow from a Chat. The original is kept unchanged as `original-plan.md`. Discuss and Research are marked **Not run**.

Your agent maps the original’s outcomes and checks into a short execution agreement. Review it with the original; settle any **Your call**, then choose **Approve Plan**. The build session writes the Outline from both documents, following the agreed order.

## What you read {#items}

For a plan prepared with QualityLayer, the page follows the sections of `03-plan.md` below. An existing plan uses the execution agreement described above; its file and Reader show that complete agreement.

| Part | What it tells you |
| --- | --- |
| **Summary** | The change in a few lines, with the size of the build, whether it is risky and what reviewed it |
| **Done means** | The results from [Discuss](discuss.md), and how each will be checked |
| **The artifact** | A wireframe or finished artifact for anything people see ([Artifacts](../artifacts.md)) |
| **Today and after the change** | A view of the change when it makes the proposal clearer |
| **Engineering decisions** | The consequential choices and their reasons, with a diagram where it helps |
| **Not doing** | What stays untouched |
| **Decisions made for you** | Your agent's smaller choices, with reasons |
| **Assumptions** | What the Plan takes for granted |
| **Before the build** | What must be ready first, such as a login |

Artifacts, wireframes and diagrams are never collapsed, so you approve what you can see. Risks, your earlier answers, assumptions, review findings and design contracts fold below them, each with a one-line summary. Both levels show the same sections; Product uses plainer words ([two levels](../intro.md#two-levels)). Patterns to follow and the proof gathered before approval stay in the document.

### What to read first {#read-first}

Start with **Look here**, under the summary. Each line names its first item and how many there are, and jumps to it:

- a risky concern
- an assumption or decision the agent is unsure of
- the trust boundary, when the Plan names one

Unresolved or unknown review findings stay visible. A recorded research source does not mean the Plan review is complete.

## Approve or give feedback {#answering}

A choice that only appears once an artifact is drawn is a **Your call**. **Your turn** shows them one at a time, with the part of the Plan each concerns, and each answer reaches your agent immediately. Findings from the technical review return to the planning agent; only a new hard choice reaches you.

1. Read the complete Plan.
2. Pin comments, or press **Give feedback**. Your agent revises; the diff shows what changed.
3. Press **Approve Plan** at the top right. It approves the Plan, **Done means** and the artifact together.

Answering a question does not approve the Plan. Approve in the App, including when the agent works in your terminal, or give an explicit approval through your agent.

## Comment on a diagram {#diagrams}

![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-light.svg)
![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-dark.svg)

Click any part of a diagram or passage to pin a comment. Your agent reads it when it next checks the task; a stopped or disconnected agent cannot answer yet. Teammates can comment too ([Plan reviews](../team/plans.md)).

## Before it reaches you {#before-it-reaches-you}

Your agent rereads every Plan as a reviewer would. A risky Plan also gets a separate review by an installed agent you choose in [Settings](../reference/settings.md#second-opinion).

While a required review runs, an amber reason sits beside the blocked **Approve Plan** button. Hover or focus the button to read why. It unlocks once required findings and human choices are settled.

Next: [Start Implement](implement.md#start-implement). The build session writes the [Outline](outline.md), then builds it.

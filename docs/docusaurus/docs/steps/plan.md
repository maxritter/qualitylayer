---
title: Plan
description: "The one document you approve before any code: what it rests on, the artifact and its decisions, and how you will know it works."
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
| **Today and after the change** | A view of the change when it makes the proposal clearer |
| **Engineering decisions** | The consequential choices and their reasons, with a diagram where it helps |
| **Not doing** | What stays untouched |
| **Decisions made for you** | Your agent's smaller choices, with reasons |
| **Assumptions** | What the Plan takes for granted |
| **Before the build** | What must be ready first, such as a login |

Artifacts and diagrams are never collapsed, so you approve what you can see; risks, findings and contracts fold below them with a one-line summary. The Product level uses plainer words ([two levels](../intro.md#two-levels)).

### What to read first {#read-first}

**Look here**, under the summary, jumps to each risky concern, each assumption or decision the agent is unsure of, and the trust boundary. Unresolved review findings stay visible.

## Approve or give feedback {#answering}

A choice that only appears once an artifact is drawn is a **Your call**. **Your turn** shows them one at a time, beside the part of the Plan each concerns; each answer reaches your agent immediately. Findings from the technical review return to the planning agent; only a new hard choice reaches you.

1. Read the complete Plan.
2. Pin comments, or press **Give feedback**. Your agent revises; the diff shows what changed.
3. Press **Approve Plan** at the top right. It approves the Plan, **Done means** and the artifact together.

Answering a question does not approve the Plan. Approve in the App, also when the agent works in your terminal, or give an explicit approval through your agent.

![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-light.svg)
![A pinned comment on a diagram: the agent answers and changes the Plan](pathname:///img/diagrams/decision-dark.svg)

### Comment on a diagram {#diagrams}

Click any part of a diagram or passage to pin a comment; your agent reads it when it next checks the task. Teammates can comment too ([Plan reviews](../team/plans.md)).

## Before it reaches you {#before-it-reaches-you}

Your agent rereads every Plan as a reviewer would; a risky Plan also gets a [second opinion](../reference/settings.md#second-opinion). While a required review runs, **Approve Plan** stays blocked with an amber reason.

## Start from an existing plan {#existing-plan}

**Existing plan**, or **Saved plan** from a Chat, keeps the original as `original-plan.md` and marks Discuss and Research **Not run**. Your agent maps it into a short execution agreement, shown instead of the sections above. Settle any **Your call**, then **Approve Plan**.

Next: [Start Implement](implement.md#start-implement). The build session writes the [Outline](outline.md), then builds it.

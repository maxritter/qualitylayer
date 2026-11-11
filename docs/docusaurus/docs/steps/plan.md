---
title: Plan
description: "Approve the proposed change, design decisions and checks before the build."
---

![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-light.svg)
![The seven steps, with Plan highlighted](pathname:///img/diagrams/track-plan-dark.svg)

The **Plan** page is the document you approve before the build. The summary, what changes, diagrams, interface and acceptance test come first. A small change keeps it brief.

![The Plan in the App: its one open decision with both paths drawn, under Give feedback and Approve Plan](pathname:///img/app/plan-light.webp)
![The Plan in the App: its one open decision with both paths drawn, under Give feedback and Approve Plan](pathname:///img/app/plan-dark.webp)

*Example task in a fictional project.*

## What you read {#items}

| Part | What it tells you |
| --- | --- |
| **Summary** | The change in a few lines, with the size of the build and what reviewed it |
| **What changes** | One bullet per change: a bold sentence saying what changes and one more sentence. Anything longer waits under **Details** |
| **Diagrams** | Up to three, in tabs: before and after, a flow, a sequence or the architecture. Open one full size: drag to pan, scroll to zoom, arrow keys to move |
| **Interface** | One tab per screen: a clickable artifact ([Artifacts](../artifacts.md)), with **Open** for a full view |
| **Acceptance test** | The deciding test as a numbered list, one row per **Done means** point, each opening to the steps that prove it (what the step does, then what passes; for a bug fix, also what shows the bug before the fix), with a mark for how it will run: a scripted run or a real agent session. [Review](review.md) shows the same steps as they ran |
| **Rollout and operations** | What ships or needs attention, when more than a normal deploy |
| **Decisions made for you**, **Assumptions**, **Not doing** and **Prerequisites** | Your agent's smaller choices with reasons, what the Plan takes for granted, what stays untouched, and what must be ready first, such as a login |

Engineering detail (code, data and interfaces, contracts, decisions and checks) folds below. **Done means and scope** repeat Discuss in the Reader.

| Read | Where |
| --- | --- |
| **The specification** | `03-plan.md`, written for people. **What we agreed** repeats Discuss's **Done means** and **Not doing**; artifact pictures stay linked |
| **Build notes** | `agents/03-plan.md`, listed under **For agents** in the Reader: code to imitate, how to start and test, pitfalls, rejected approaches and the risks with the test that guards each. They never change what you approve |
| **A portable copy** | `qualitylayer plan export --out <folder>` exports the Plan, `01-discuss.md` and pictures for readers without QualityLayer |

The Product level uses plainer words ([two levels](../intro.md#two-levels)).

## Approve or ask for a revision {#answering}

A choice only you can make appears as **Your call** beside its subject. The header counts open calls, and answers reach your agent immediately. The planning agent clears every risk and doubt first, by asking you or settling it itself; the Plan then marks nothing as risky or open.

1. Read the complete Plan.
2. Choose **Ask agent** on a passage or preview, edit the Conversation draft and send it. Your agent revises; the diff shows what changed.
3. Once every call is answered, choose **Approve and build here**. The planning session keeps its history and settings and builds after its current turn. **Choose where to build**, under the arrow, opens the build card instead. Both approve the Plan, **Done means**, the artifacts and the acceptance test together.

For a waiting terminal planner, **Build in &lt;agent&gt; · terminal** starts the build from the Plan: run your agent's compact command, then say "build here". Under the arrow you can keep the conversation instead, or use another session with a prepared prompt.

Answering a question does not approve the Plan. Approve in the App, also when the agent works in your terminal, or give an explicit approval through your agent.

![An example retry decision diagram: Ask agent prepares an editable contextual draft in Conversation](pathname:///img/diagrams/decision-light.svg)
![An example retry decision diagram: Ask agent prepares an editable contextual draft in Conversation](pathname:///img/diagrams/decision-dark.svg)

### Ask about a diagram {#diagrams}

Choose **Ask agent** on a diagram, screen or passage to prepare a contextual request. Sending the request is separate from approving the displayed Plan. A revised Plan needs approval of its new revision.

## Before it reaches you {#before-it-reaches-you}

Your agent rereads the Plan as a reviewer would. Risky Plans also get a [second opinion when enabled](../reference/settings.md#second-opinion) from another model. With Plan reviewers on Panel, up to three models read every Plan except a small task's and answer each other once. Required reviews keep **Approve Plan** blocked with an amber reason until they finish.

## Start from an existing plan {#existing-plan}

**Existing plan**, or **Saved plan** from a Chat, keeps the original as `original-plan.md` and marks Discuss and Research **Not run**. Your agent maps it into a short execution agreement, shown instead of the sections above. Settle any **Your call**, then **Approve Plan**.

Next: [Start Implement](implement.md#start-implement). The build session writes the [Outline](outline.md), then builds it.

---
title: Plan
description: "Your agent reads the code, asks what only you can answer and writes one Plan. You approve it before any code."
---

![The three steps, with Plan highlighted](pathname:///img/diagrams/track-plan-light.svg)
![The three steps, with Plan highlighted](pathname:///img/diagrams/track-plan-dark.svg)

Describe the change with **+ › Task**, or ask your agent: “Using QL, plan a CSV export.” Your agent reads the code, asks only about choices the code leaves open, each with a recommendation, and writes the Plan. You approve it once, before the build. A small change keeps it brief.

![The Plan in the App: its one open decision with both paths drawn, beside the agent's conversation](pathname:///img/app/plan-light.webp)
![The Plan in the App: its one open decision with both paths drawn, beside the agent's conversation](pathname:///img/app/plan-dark.webp)

*Example task in a fictional project.*

## Answer the questions {#the-question}

1. **Your turn** shows one question at a time. Pick a choice, or write your own answer and press **Send**.
2. Answer in any order from the numbered strip. **Use all recommended** takes every recommendation; **Tell me more** explains.
3. Each answer reaches your agent immediately; **Change** reopens it. Another question comes only if an answer or finding raises a new decision.

Independent questions can arrive together; a dependent one follows the answer it needs ([all controls](../app.md#questions)). While you answer, your agent goes on reading the code. Helpers that read it do not see your request, and each cited file is reopened before a finding is written.

## What you read {#items}

| Part | What it tells you |
| --- | --- |
| **Summary** | What users get, in one or two lines, with the size of the build and what reviewed it |
| **Problem** | Who has it, what it costs, what is missing |
| **Done means** | The numbered results you accept the change by. Each row opens to the steps that prove it (for a bug fix, also what shows the bug before the fix), with a mark for how it will run: a scripted run or a real agent session. [Verify](verify.md) shows the same rows as they ran |
| **Scope** | In scope and out of scope |
| **Diagrams** | Up to three, in tabs: before and after, a flow, a sequence or the architecture. Open one full size: drag to pan, scroll to zoom, arrow keys to move |
| **Interface** | One tab per screen: a clickable artifact ([Artifacts](../artifacts.md)), with **Open** for a full view |
| **Approach** | What was chosen, what it gives and what it costs, then at most five bullets of what changes |
| **Rollout and operations** | What ships or needs attention, when more than a normal deploy |
| **Decided with you**, **Decisions made for you** and **Prerequisites** | Your answers, your agent's smaller choices with reasons, and what must be ready first, such as a login |

**Technical** folds below hold the current system, data and interfaces, engineering decisions and assumptions. **Original request** stays collapsed at the bottom.

| Read | Where |
| --- | --- |
| **The Plan** | `01-plan.md`, written for people; artifact pictures stay linked |
| **Build notes** | `agents/01-plan.md`, under **For agents** in the Reader: constraints, findings, code to imitate, checks, rejected approaches and the risks with the test that guards each. They never change what you approve |
| **Helpers' reports** | `research/`, one file per question, linked one line each from the build notes |
| **A portable copy** | `qualitylayer plan export --out <folder>` exports the Plan and its pictures for readers without QualityLayer |

## Approve or ask for a revision {#answering}

A choice only you can make appears as **Your call** beside its subject. The header counts open calls. The planning agent clears every risk and doubt first, by asking you or settling it itself; the Plan then marks nothing as risky or open.

1. Read the complete Plan.
2. Choose **Ask agent** on a passage or preview, edit the Conversation draft and send it. Your agent revises; the diff shows what changed.
3. Once every call is answered, choose **Approve and build here**. The planning session keeps its history and settings and builds after its current turn. **Choose where to build**, under the arrow, opens the build card instead. Both approve the Plan, **Done means**, the artifacts and the steps that prove them together.

For a planner waiting in your own agent, **Build in &lt;agent&gt; · your agent** starts the build from the Plan: run your agent's compact command, then say "build here". Under the arrow you can keep the conversation instead, or use another session with a prepared prompt.

Answering a question does not approve the Plan. Approve in the App, also when you work in your own agent, or give an explicit approval through your agent. Later changes to what you approved are recorded as amendments and stay visible on Verify.

![An example retry decision diagram: Ask agent prepares an editable contextual draft in Conversation](pathname:///img/diagrams/decision-light.svg)
![An example retry decision diagram: Ask agent prepares an editable contextual draft in Conversation](pathname:///img/diagrams/decision-dark.svg)

### Ask about a diagram {#diagrams}

Choose **Ask agent** on a diagram, screen or passage to prepare a contextual request. Sending the request is separate from approving the displayed Plan. A revised Plan needs approval of its new revision.

## Before it reaches you {#before-it-reaches-you}

Your agent rereads the Plan as a reviewer would. Risky Plans also get a [second opinion when enabled](../reference/settings.md#second-opinion) from another model. For a feature, you can add up to two [extra planners](../reference/settings.md#second-opinion) in **New task**, each with its own agent, model and effort. They review the Plan instead of the second opinion, and each is an extra paid planning run. Required reviews keep **Approve Plan** blocked with an amber reason until they finish.

## A bug {#a-bug}

A bug's Plan says what breaks and why: when it happens, what goes wrong, what should happen and what must keep working, with the reproduction and the cause. Its **Done means** start with a real failure before the fix.

![Bug diagnosis: when, what happens, what is expected, what must keep working](pathname:///img/diagrams/diagnose-light.svg)
![Bug diagnosis: when, what happens, what is expected, what must keep working](pathname:///img/diagrams/diagnose-dark.svg)

## Too small for a plan {#too-small}

Small requests keep a short Plan and one slice. If you ask for a plain prompt instead, your agent hands one back and closes the task.

## Starting without a ticket {#prd}

When you ask for a PRD, or what to build is still open, the Plan adds a success measure and a first release. **Copy** exports it.

## Start from an existing plan {#existing-plan}

**Existing plan**, or **Saved plan** from a Chat, keeps the original as `original-plan.md` and maps it into `01-plan.md`. Settle any **Your call**, then **Approve Plan**.

Next: [Implement](implement.md#start-implement).

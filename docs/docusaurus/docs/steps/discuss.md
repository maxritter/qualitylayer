---
title: Discuss
description: Your agent reads the code and asks until it knows what you want and what done means.
---

![The seven steps, with Discuss highlighted](pathname:///img/diagrams/track-discuss-light.svg)
![The seven steps, with Discuss highlighted](pathname:///img/diagrams/track-discuss-dark.svg)

Describe the change with **+ New**, or ask your agent: “Using QL, plan a CSV export.” Your agent reads the code and asks only about unresolved choices, each with a recommendation. Independent choices can arrive together; a dependent choice follows the answer it needs.

![Discuss in the App: one question with its choices](pathname:///img/app/discuss-light.webp)
![Discuss in the App: one question with its choices](pathname:///img/app/discuss-dark.webp)

*Example task in a fictional project.*

## Answer the batch {#the-question}

1. **Your turn** shows one question at a time. Pick a choice, or write your own answer and press **Send**.
2. Answer in any order. **Skip for now** moves on; **Tell me more** explains.
3. Each answer reaches your agent immediately. Another question comes only if an answer or finding raises a new decision.

[Research](research.md) can start while you answer ([all controls](../app.md#questions)).

## What done means {#done-means}

`01-discuss.md` records your request, the scope and **Done means**: the numbered results you accept the change by. Verify checks each one. You approve it with the Plan. Later changes are recorded as amendments and remain visible in the final review.

The agent's **Problem**, facts and **Done means** lead the page once written. **Original request** stays collapsed at the bottom; open it to read the complete text. While the agent prepares Discuss, the task keeps its real title and your request remains available there.

## Too small for a plan {#too-small}

Small requests keep a short Plan and one slice. If you ask for a plain prompt instead, your agent hands one back and closes the task.

## Starting without a ticket {#prd}

When what to build is still open, the document becomes a PRD with a success measure and a first release. **Copy** exports it.

## A bug {#a-bug}

You agree on when it happens, what goes wrong, what should happen and what must keep working. Research finds the cause.

![Bug diagnosis: when, what happens, what is expected, what must keep working](pathname:///img/diagrams/diagnose-light.svg)
![Bug diagnosis: when, what happens, what is expected, what must keep working](pathname:///img/diagrams/diagnose-dark.svg)

## At the Product level {#product-level}

Questions use product words and cover only what remains open. Changed screens appear as product-faithful artifacts; wireframes help settle an unresolved layout ([two levels](../intro.md#two-levels)). The page keeps the PRD's sections open, since the file is the PRD.

Next: [Research](research.md).

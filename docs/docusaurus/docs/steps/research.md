---
title: Research
description: Agents read the code before anything is designed. You settle only what the code leaves open.
---

![The seven steps, with Research highlighted](pathname:///img/diagrams/track-research-light.svg)
![The seven steps, with Research highlighted](pathname:///img/diagrams/track-research-dark.svg)

Research maps how the code works today. It can start while you answer Discuss and needs no approval.

![Research in the App: the code today and the findings](pathname:///img/app/research-light.webp)
![Research in the App: the code today and the findings](pathname:///img/app/research-dark.webp)

*Example task in a fictional project.*

## What your agent does {#what-the-agent-does}

| | |
| --- | --- |
| **Reads without your request** | Research helpers do not see your request; without helpers, your agent reads the code as it is before proposing changes |
| **Checks claims** | Each cited file is reopened before a finding is written |
| **Draws today** | One picture of the code your request touches, and what that code makes easy, hard or risky for your request |
| **Names risks** | Code to reuse, files that change often, how it is tested |

For a bug, Research is the diagnosis: how to reproduce it, the cause, what was ruled out.

## What you do {#what-you-do}

Usually nothing. Comment on a finding you disagree with. If the code leaves a real choice open, **Your turn** asks what only you can decide. Independent questions can arrive together.

## The document {#the-page}

The page opens with a **Summary**, then **Current system**: a diagram and one row per part of the code. **Impact** explains what is easy, hard or risky; a row opens to its sources, which link to the findings in the Reader.

`02-research.md` holds the findings and questions; the agent's working notes sit under **For agents**.

Next: [Plan](plan.md).

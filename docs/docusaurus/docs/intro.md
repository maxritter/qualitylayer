---
slug: /
title: Overview
description: Plan, implement and verify software with your favorite coding agents.
---

<figure class="ql-film">
  <a href="https://youtu.be/p1m4O4xRsrQ" target="_blank" rel="noopener noreferrer"><img src="https://qualitylayer-media.max-ritter.workers.dev/overview-v2026102001.webp" alt="Play video on YouTube: how QualityLayer works" width="1280" height="720" /></a>
  <figcaption>How QualityLayer works, in about five minutes. <a href="https://youtu.be/p1m4O4xRsrQ" target="_blank" rel="noopener noreferrer">Watch on YouTube</a></figcaption>
</figure>

Plan, implement and verify software with your favorite coding agents. Agree on diagrams and clickable designs before building, then review the tested change.

**Start here:** [Install](install.md) · [First task](first-task.md) · [Chat](chat.md) · [The App](app.md) · [Workflow](steps/plan.md) · [Artifacts](artifacts.md)

## Choose how to work {#choose-how-to-work}

| Start | What you get |
| --- | --- |
| **Chat** | A direct conversation with Claude Code or Codex, with no steps or gates. Move it into the workflow later ([Chat](chat.md)) |
| **Feature** or **Bugfix** | The three steps below, from **Plan with QualityLayer** (default) or an **Existing plan** you paste or attach |

## The workflow {#the-three-steps}

![The workflow from Plan to the pull request; you approve the Plan and the finished change, and merge](pathname:///img/diagrams/flow-pr-light.svg)
![The workflow from Plan to the pull request; you approve the Plan and the finished change, and merge](pathname:///img/diagrams/flow-pr-dark.svg)

You approve twice: the Plan and the finished change. In between, your agent works on its own and asks only what needs you.

| Step | What happens |
| --- | --- |
| **[Plan](steps/plan.md)** | Your agent reads the code and asks until it knows what done means. Diagrams and clickable designs; you approve the Plan |
| **[Implement](steps/implement.md)** | Your agent cuts the Plan into slices, builds them test first and fixes what fails |
| **[Verify](steps/verify.md)** | Project checks, then an agent that did not write the code rules on every point. You review the code and approve |
| **[Pull request](steps/pull-request.md)** | After your approval: your agent fixes failing checks and routine threads. You merge |

The agent decides how to carry out each step. QualityLayer enforces only your two approvals, a visible amendment for any change to what you approved, and recorded evidence for every check.

## Who it is for

Medium and large changes in your repositories. Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode and GitHub Copilot [run natively](agents/native.md); [other agents](agents/other.md) use the CLI. Each keeps its own login.

## How it fits together {#how-it-fits-together}


Task documents `01-plan.md`, `02-implement.md` and `03-verify.md`, each with a file for your agents beside it, stay in your repository, even after you uninstall ([files](reference/files.md#documents)). Your chosen agent uses its own provider; [files and privacy](reference/files.md#privacy) explains the separate service calls.

---
title: Implement
description: Start the build in the App or your terminal. Your agent builds the approved Plan test first and decides when it is ready for Verify.
---

![The workflow, with Implement highlighted](pathname:///img/diagrams/track-implement-light.svg)
![The workflow, with Implement highlighted](pathname:///img/diagrams/track-implement-dark.svg)

## Start the build {#start-implement}

After you approve the Plan, **Start the build** appears on the Plan page.

![The Implement start card](pathname:///img/app/implement-start-light.webp)
![The Implement start card](pathname:///img/app/implement-start-dark.webp)

*Example task in a fictional project.*

| On the card | What it picks |
| --- | --- |
| **Agent** | The coding agent for this build |
| **Lead and effort** | The model and effort for the session that writes and tests the code |
| **Subagents** | Claude Code's default for delegated work; other agents choose their own |
| **Files and workspace** | Attachments, run location and [branch/worktree choices](#where-it-lands) |

Press **Approve & start**, or **Approve & copy prompt** for your terminal; that prompt says `implement the approved task`. Closing the sidebar keeps the run ([agent runs](../app.md#agent-runs)).

### Where the build lands {#where-it-lands}

A new branch or worktree starts from this checkout's HEAD; a worktree's name sets its folder and branch, next to your project. `qualitylayer branch new [name]` does the same from the terminal. A pull request needs a branch other than its target. Pushes and deployments need the Plan's authorization; merging stays yours.

## While the agent builds

![Implement in the App: slices and their progress](pathname:///img/app/implement-light.webp)
![Implement in the App: slices and their progress](pathname:///img/app/implement-dark.webp)

*Example task in a fictional project.*

The **Implement** page shows each slice's progress. Your lead writes a failing test first, then builds the change, fixes failures and commits. It may delegate independent slices to subagents.

![Slices built test first, one after another, then the checks in Verify](pathname:///img/diagrams/slices-light.svg)
![Slices built test first, one after another, then the checks in Verify](pathname:///img/diagrams/slices-dark.svg)

- Test runs are recorded with their commit and exit code, so [Verify](verify.md) can cite them.
- Routine choices appear under **Decided while building**. A change to what you approved becomes a visible amendment, listed in Review.
- A login, secret or other human-only prerequisite stays unverified for Review. Other work continues, blocked checks are never marked passed, and the App never takes the secret.
- Outline, Implement and Verify ask no workflow questions until Review.
- Runs start in the agent's own [permission mode](../agents/native.md#permission-modes). Native permission and sign-in prompts still need your response, and an explicit stop or pause stays in force.

## When the build is done {#when-done}

The session decides when the build is ready, and Verify starts on what it committed. Unticked cards and open needs reach Review as open items, never as passed.

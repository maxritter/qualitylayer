---
title: Implement
description: Start the build in the App or in your own agent. Your agent cuts the approved Plan into slices and builds them test first, without a stop.
---

![The three steps, with Implement highlighted](pathname:///img/diagrams/track-implement-light.svg)
![The three steps, with Implement highlighted](pathname:///img/diagrams/track-implement-dark.svg)

## Start the build {#start-implement}

**Approve and build here** continues the App's planning session after its turn. A waiting terminal planner gets **Build in &lt;agent&gt; · terminal**. Otherwise **Start the build** opens on Plan.


| On the card | What it picks |
| --- | --- |
| **Agent** | The coding agent for this build |
| **Build model** and **Effort** | The model and effort for the session that writes and tests the code, with the recommended model and why |
| **Subagent model** | Claude Code only, folded: the model for slices it hands to subagents; other agents choose their own |
| **What's different** | What changes for the chosen agent, for example questions as numbered choices |
| **Files for the build** and **Workspace** | Attachments, run location and [branch/worktree choices](#where-it-lands) |

Press **Approve & start** for an App run. **In my own agent** shows one request box with **Copy** and a folder chip; hover for the full path or click to copy it. Paste into any agent, or ask in your own words.

For a pending Plan, **Approve and copy** approves it and copies the request. After approval, **Ready to build** offers **Copy prompt**. Closing the sidebar keeps the run ([agent runs](../app.md#agent-runs)).

### Where the build lands {#where-it-lands}

A new branch or worktree starts at this checkout's HEAD. A worktree's name sets its branch and folder beside the project. The terminal equivalent is `qualitylayer branch new [name]`. Pull requests need a branch other than their target. Pushes and deployments need the Plan's authorization; you control merging.

## While the agent builds

![Implement in the App: slices and their progress](pathname:///img/app/implement-light.webp)
![Implement in the App: slices and their progress](pathname:///img/app/implement-dark.webp)

*Example task in a fictional project.*

Your agent first cuts the Plan into slices that each work end to end, thinnest first, and each slice into task cards. The first slice starts as soon as its cards exist. For a bug, reproduction comes before the repair.

**Implement** is the build board: every slice open for a small build, the one in work for a larger one, and past 10 slices the finished ones in one row. A task opens to one sentence and its card (files, test first, done when). The header counts tasks and slices and names the task in work. A failing check is your agent's to fix, so the page does not flag it; a check that blocks the build reaches you as a question, and the final approval still refuses a red check. Your agent writes a failing test, builds the change, fixes failures and commits. It may delegate independent slices.

![Slices built test first, one after another, then the checks in Verify](pathname:///img/diagrams/slices-light.svg)
![Slices built test first, one after another, then the checks in Verify](pathname:///img/diagrams/slices-dark.svg)

- Test runs are recorded with their commit and exit code, so [Verify](verify.md) can cite them. Your agent runs each **Done means** step on the built tree before Verify starts.
- **Known limits**, **Decided while building** and **Program design** fold under the board. A row under **Decided while building** says whether it is the build order or an amendment to what you approved; a task card that changes is the agents' business.
- A login, secret or other human-only prerequisite never counts as passed. Other work continues: it waits as a need, you get one question at the end of [Verify's checks](verify.md#when-it-stops) if it is still missing, and the App never takes the secret.
- Implement and Verify decide for themselves. A matter only you can settle is asked once, and the build goes on while you answer.
- Runs start in the agent's own [permission mode](../agents/native.md#permission-modes). Native permission and sign-in prompts still need your response, and an explicit stop or pause stays in force.

## When the build is done {#when-done}

The session decides when the build is ready, and Verify starts on what it committed. Unticked cards and open needs stay open in Verify, never passed.

Next: [Verify](verify.md).

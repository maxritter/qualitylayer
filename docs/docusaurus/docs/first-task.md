---
title: Your first task
description: Choose Chat for a direct conversation, or Feature and Bugfix for a planned change.
---

![Your first task in seven moves: describe the change, answer its questions, approve the Plan, start Implement, agents build and check, settle what is left, approve the change](pathname:///img/diagrams/firsttask-light.svg)
![Your first task in seven moves: describe the change, answer its questions, approve the Plan, start Implement, agents build and check, settle what is left, approve the change](pathname:///img/diagrams/firsttask-dark.svg)

Open QualityLayer in the App or browser and choose **+ New**. Pick **Chat** for a direct conversation with Claude Code or Codex. Its conversation fills the task page, with the agent's questions above the composer and its task list when it has one. Save a plan, build in slices, make artifacts or ask for checks and an independent review when needed. **Start the workflow** keeps the same task: **Plan with QualityLayer** continues in Discuss, while **Saved plan** starts at Plan from a plan saved in the Chat. [Chat guide](chat.md).

For the structured workflow, pick a **Feature** or **Bugfix** in a repository you know. **Plan with QualityLayer** is the default: describe the change and follow the steps below.

With **Existing plan**, paste a plan or attach a Markdown or plain-text file, then choose **Start from this plan**. QualityLayer keeps the original unchanged and starts at Plan. Review the execution agreement and approve it before the agent writes the Outline and builds. Discuss and Research are marked **Not run**.

The task is on the left; your agent works in the **Agent** sidebar on the right.

| | You do |
| --- | --- |
| 1 | Choose **+ New** and **Feature** or **Bugfix**. Describe the change, attach files if needed, then choose your agent |
| 2 | **Answer the questions** in **Your turn**. They arrive as a batch; each answer reaches your agent at once |
| 3 | **Read the Plan**, then **Approve Plan** or **Give feedback** |
| 4 | **Start the build** |
| 5 | Follow Outline, Implement and Verify. Anything only you can do is recorded for Review |
| 6 | **Confirm what only you can**, look at the result, approve |
| 7 | **Merge the pull request** on GitHub |

Steps 1 to 6 happen in the App or browser.

## Where your agent runs

For **Feature** and **Bugfix**, **New task** and **Start the build** both ask where the agent runs:

- **In the App** (recommended): pick the agent, model, effort, project and branch. The agent opens beside the task, and every question and piece of feedback happens in the App.
- **In my terminal**: copy one prompt into any coding agent, app or IDE. Files you attached are listed in the prompt by path. The agent asks its questions and takes your feedback in its own chat.

A fresh launch starts **In the App**. An unfinished draft keeps your choice. If the agent cannot run there, the terminal option stays available. More in [Agent runs](app.md#agent-runs).

Seven agents have [native setup and session controls](agents/native.md). Other coding agents [use the CLI and a copied prompt](agents/other.md). [Settings](reference/settings.md) cover agents, plan limits, reviewers and appearance.

<details>
<summary>Good to know</summary>

- When the agent runs in your terminal, it asks each decision in its own chat. You can still approve the workflow Plan and final Review in the App.
- Say QualityLayer or QL when you ask the agent to start work. Follow-up answers continue the authorized task, and no slash command is needed.
- Each step page opens with what needs you, then the gist, then **Look here** for anything only you can still do ([the step page](app.md#step-pages)).
- **Skip for now** moves to the next question; **Tell me more** asks for detail.
- Select a passage to give feedback. It reaches the agent when it next reads the task; a stopped or disconnected agent cannot answer yet.
- You can stop or pause the run. Your agent's own permission and sign-in prompts still need your response.
- To continue elsewhere, stop the old run if it is still active. Then name the same task: “Using QL, continue implementation of task retry-webhooks.” Its recorded stage, approved Plan and evidence are kept.
- With several approved Plans waiting, "Implement this using QualityLayer" lists their commands.

</details>

Next: [The App](app.md), then [the steps](steps/discuss.md).

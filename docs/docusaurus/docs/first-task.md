---
title: Your first task
description: Choose Chat for a direct conversation, or Feature and Bugfix for a planned change.
---

![Your first task in seven moves: describe the change, answer its questions, approve the Plan, start Implement, agents build and check, settle what is left, approve the change](pathname:///img/diagrams/firsttask-light.svg)
![Your first task in seven moves: describe the change, answer its questions, approve the Plan, start Implement, agents build and check, settle what is left, approve the change](pathname:///img/diagrams/firsttask-dark.svg)

Open QualityLayer in the App or browser, choose **+ New** and pick **Feature** or **Bugfix** in a repository you know. The task is on the left; your agent works in the **Agent** sidebar on the right.

| | You do |
| --- | --- |
| 1 | Describe the change, attach files if needed, then choose your agent and where it runs |
| 2 | **Answer the questions** in **Your turn**. Each answer reaches your agent at once |
| 3 | **Read the Plan**, then **Approve Plan** or **Give feedback** |
| 4 | **Start the build** |
| 5 | Follow Outline, Implement and Verify. Anything only you can do is recorded for Review |
| 6 | **Confirm what only you can**, look at the result, approve |
| 7 | **Merge the pull request** on GitHub |

Steps 1 to 6 happen in the App or browser.

**Plan with QualityLayer** is the default. With **Existing plan**, paste a plan or attach a Markdown or plain-text file and choose **Start from this plan**: the task starts at Plan, with the original kept unchanged ([existing plans](steps/plan.md#existing-plan)). For a conversation without steps, pick **Chat** instead ([Chat](chat.md)).

## Where your agent runs

**New task** and **Start the build** both ask:

- **In the App** (recommended): pick the agent, model, effort, project and branch. Questions and feedback happen in the App.
- **In my terminal**: copy one prompt into any coding agent, app or IDE; attached files are listed by path. The agent asks in its own chat. You can still approve the Plan and final Review in the App.

More in [agent runs](app.md#agent-runs). Seven agents have [native setup](agents/native.md); others [use the CLI](agents/other.md).

<details>
<summary>Good to know</summary>

- Say QualityLayer or QL when you ask the agent to start work. Follow-up answers continue the task; no slash command is needed.
- **Skip for now** moves to the next question; **Tell me more** asks for detail.
- Select a passage to give feedback. It reaches the agent when it next reads the task; a stopped or disconnected agent cannot answer yet.
- You can stop or pause the run. Your agent's own permission and sign-in prompts still need your response.
- To continue elsewhere, stop the old run if it is still active, then name the task: “Using QL, continue implementation of task retry-webhooks.” Its stage, approved Plan and evidence are kept.
- With several approved Plans waiting, "Implement this using QualityLayer" lists their commands.

</details>

Next: [The App](app.md), then [the steps](steps/discuss.md).

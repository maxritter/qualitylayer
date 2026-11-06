---
title: Your first task
description: Choose Chat for a direct conversation, or Feature and Bugfix for a planned change.
---

![Your first task in seven moves: describe the change, answer its questions, approve the Plan, start Implement, agents build and check, settle what is left, approve the change](pathname:///img/diagrams/firsttask-light.svg)
![Your first task in seven moves: describe the change, answer its questions, approve the Plan, start Implement, agents build and check, settle what is left, approve the change](pathname:///img/diagrams/firsttask-dark.svg)

Choose **+ › Task**, then **Feature** or **Bugfix**, in a repository you know. The task appears on the left; your agent works in **Conversation** on the right.

| | You do |
| --- | --- |
| 1 | Describe the change, attach files if needed, then choose your agent and where it runs |
| 2 | **Answer the questions** in **Your turn**. Each answer reaches your agent at once |
| 3 | **Read the Plan**, then **Approve and build here** or **Give feedback** |
| 4 | The planning session builds; or choose another agent or place with **Choose where to build** |
| 5 | Follow Outline, Implement and Verify. Anything only you can do is recorded for Review |
| 6 | **Review the code and checks**, then approve |
| 7 | **Merge the pull request** on GitHub |

Steps 1 to 6 happen in the App or browser.

To reuse a plan, choose **Existing plan**, paste or attach it, then **Start from this plan** ([details](steps/plan.md#existing-plan)). Otherwise **Plan with QualityLayer** is the default. **+ › Chat** starts a conversation without steps ([Chat](chat.md)).

## Where your agent runs

**New task** and **Start the build** both ask:

- **In the App** (recommended): pick the agent, model, effort, project and branch. Questions and feedback happen in the App.
- **In my terminal**: ask any coding agent, app or IDE in your own words, or copy the prepared prompt; attached files are listed by path. The agent asks in its own chat. You can still approve the Plan and final Review in the App, or [work only in your agent](work-in-your-agent.md).

[Agent runs](app.md#agent-runs) · [Supported agents](agents/native.md) · [Other agents](agents/other.md)

<details>
<summary>Good to know</summary>

- Say QualityLayer or QL when you ask the agent to start work. Follow-up answers continue the task; no slash command is needed.
- Answer in any order from the numbered strip; **Tell me more** asks for detail.
- Select a passage to give feedback. It reaches the agent when it next reads the task; a stopped or disconnected agent cannot answer yet.
- You can stop or pause the run. Your agent's own permission and sign-in prompts still need your response.
- To continue elsewhere, stop the active run and ask: “Using QL, continue task retry-webhooks.” The Plan and evidence stay with the task.
- With several approved Plans waiting, "Implement this using QualityLayer" lists their commands.

</details>

Next: [The App](app.md), then [the steps](steps/discuss.md).

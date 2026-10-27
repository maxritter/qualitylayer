---
title: Other agents
description: Use QualityLayer with any coding agent that can run shell commands, including one that runs a model on your own machine.
---

[Claude Code, Codex, Cursor, Grok, Antigravity, Pi and OpenCode](native.md) run directly in the App or browser beside your task. The CLI connects other agents that can run shell commands in your repository, including one on a local model.

![Another agent with the qualitylayer command and a prompt from the App follows the same steps](pathname:///img/diagrams/agents-other-light.svg)
![Another agent with the qualitylayer command and a prompt from the App follows the same steps](pathname:///img/diagrams/agents-other-dark.svg)

## Start a task {#start}

1. In the agent's terminal, run `qualitylayer help`. Nothing listed? Run `qualitylayer doctor`.
2. In the App, choose **+ New**, describe the change, then choose **In my terminal** and copy the prompt.
3. Paste it into your agent. It asks its questions and takes your feedback in its own chat.

## Plan with one agent, build with another {#mix}

![Plan with Claude Code, approve the Plan, build with another agent, then the same checks and your approval](pathname:///img/diagrams/agents-mix-light.svg)
![Plan with Claude Code, approve the Plan, build with another agent, then the same checks and your approval](pathname:///img/diagrams/agents-mix-dark.svg)

Pick **In my terminal** when you start the build and copy its prompt. The agent then follows Outline, Implement and Verify until Review.

## Run in your terminal {#app-start}

A copied prompt works in any coding agent, but does not add the App's conversation view or session controls; those belong to the seven supported agents.

## What changes {#differences}

| | The seven native agents | Any other agent |
| --- | --- | --- |
| Setup | Done when you install | One pasted prompt |
| Model and effort | Set in QualityLayer | Set in your agent |
| Building | One session builds the slices; it can use its agent's own subagents | One session builds the slices with its own tools |
| Sessions | The App's **Conversation** and supported session controls | Your agent's terminal and its own controls |
| Cost panel | Per step, when the agent's records hold token counts | Not shown |
| [Second opinion](../reference/settings.md#second-opinion) | Choose an installed native reviewer | Can use an installed native reviewer |

Results depend on the model: it has to call tools reliably over many turns.

<details>
<summary>For the agent's author</summary>

The prompt asks the agent to run `qualitylayer next --json`, follow the reply and read the files it names, until the reply says done or stop.

To keep working after a question, run `qualitylayer wait --until-event` in the background. It returns on an answer, comment, review result or finished check, or after 30 minutes.

Checks run on a clean copy of the commit, without `.venv` or `node_modules`. Use `$QL_REPO_ROOT` to reach your folder, for example `"$QL_REPO_ROOT/.venv/bin/python" -m pytest`.

</details>

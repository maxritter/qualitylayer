---
title: Machines
description: Run agents on a Mac Mini or in a VS Code dev container, and manage them from the App on your laptop.
---

The App on your laptop can run tasks on another computer you reach over ssh: a Mac Mini, a Linux server or a dev container. Agents there keep working while your laptop sleeps. You choose the computer in the sidebar's head, and a count there shows what waits for you on it.

![The sidebar's head lists This computer and mac-mini, with 2 waiting on mac-mini](pathname:///img/app/machines-switcher-light.webp)
![The sidebar's head lists This computer and mac-mini, with 2 waiting on mac-mini](pathname:///img/app/machines-switcher-dark.webp)

**You need** a macOS or Linux computer with Git, your repository and your coding agent signed in, and an ssh key on your laptop. QualityLayer never asks for a password and stores none.

## A Mac Mini or any second computer {#second-machine}

1. **Turn on ssh.** On the Mac Mini, open System Settings › General › Sharing and turn on **Remote Login**. On Linux, install `openssh-server`.
2. **Let your key in and name the computer.** On your laptop:

   ```bash
   ssh-keygen -t ed25519          # only if you have no key yet
   ssh-copy-id you@mac-mini.local
   ```

   ```text title="~/.ssh/config"
   Host mac-mini
     HostName mac-mini.local
     User you
   ```

   Run `ssh mac-mini true` once and accept the host key. It must return without asking anything.
3. **Sign in to your agent there.** On the Mac Mini, start Claude Code or Codex once and sign in.
4. **Add it.** In the App, open **Settings › Machines › Add machine**, pick `mac-mini` and choose **Install and add**. The App installs QualityLayer there, activates your licence key on it and connects.
5. **Open it.** Choose **mac-mini** in the sidebar's head. On its Setup page, type your project's path, such as `/Users/you/code/api`, and choose **Add folder**.
6. **Work.** Start a task there [in the App or in your own agent](#work).

## A VS Code dev container {#dev-containers}

1. **Add an ssh server and your key** to the project's `.devcontainer/devcontainer.json`. Give each container its own port on your laptop: `2223`, `2224` and so on.

   ```json title=".devcontainer/devcontainer.json"
   {
     "image": "mcr.microsoft.com/devcontainers/base:ubuntu-24.04",
     "features": { "ghcr.io/devcontainers/features/sshd:1": {} },
     "appPort": ["127.0.0.1:2223:2222"],
     "mounts": [
       "source=${localEnv:HOME}/.ssh/id_ed25519.pub,target=/tmp/qualitylayer-key.pub,type=bind,readonly"
     ],
     "postCreateCommand": "mkdir -p ~/.ssh && cat /tmp/qualitylayer-key.pub >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
   }
   ```

2. **Start it.** Choose **Reopen in Container** in VS Code, or run `devcontainer up --workspace-folder .` with the [Dev Container CLI](https://github.com/devcontainers/cli).
3. **Name it.** Add it to `~/.ssh/config` and run `ssh api-devcontainer true` once:

   ```text title="~/.ssh/config"
   Host api-devcontainer
     HostName 127.0.0.1
     Port 2223
     User vscode
   ```

4. **Sign in to your agent inside the container**, as on any computer.
5. **Add it and open it.** In the App, add `api-devcontainer` under **Settings › Machines**, choose it in the sidebar's head and add `/workspaces/api` on its Setup page.
6. **Work.** Start a task there [in the App or in your own agent](#work).

## Work on the machine {#work}

![A Plan on mac-mini, open in the App on the laptop](pathname:///img/app/machines-machine-light.webp)
![A Plan on mac-mini, open in the App on the laptop](pathname:///img/app/machines-machine-dark.webp)

**In the App.** With the machine chosen, start a task with **+** as on your laptop. The agent runs on the machine, and its Terminal pane shows it here. The agent's questions open as cards in the App; you can also type your answer in the Terminal pane. Approve the Plan with **Approve and build here**.

**In your own agent.** Open a terminal on the machine (`ssh mac-mini`), go to the project and say "Using QualityLayer, plan …" to Claude Code or Codex. The first time, the agent asks where you answer and approve:

- **Here in the agent:** questions and the Plan's approval come in the agent's chat.
- **In the App:** they come to the App on your laptop, under the machine. The agent waits until you answer.

You can change the place later on the machine, in **Settings › Workflow**.

![A question from an agent on mac-mini, answered in the App](pathname:///img/app/machines-question-light.webp)
![A question from an agent on mac-mini, answered in the App](pathname:///img/app/machines-question-dark.webp)

What waits on a machine raises the count on the sidebar's head. Its notification names the machine first: "mac-mini: Show greet version: Plan ready". A machine counts as one of your licence's 5 computers.

## When something is off {#troubleshooting}

| What you see | What to do |
| --- | --- |
| **ssh needs you** or **Unknown host** in Settings › Machines | Run the `ssh` command the row shows once in a terminal, then **Try again**. |
| The agent waits at "Trust this folder?" | Answer in the agent's terminal: the task's Terminal pane in the App, or your own terminal. Each agent asks once per folder. |
| An agent shows **Not installed** or not signed in on the machine's Setup page | Install or sign in to it on the machine, then choose **Check again**. |
| The machine runs an older QualityLayer | Choose **Update to …** in the machine's **⋯** menu under Settings › Machines. |
| A rebuilt dev container no longer connects | Its host key changed: run `ssh-keygen -R "[127.0.0.1]:2223"` and `ssh api-devcontainer true`. A rebuild also removes QualityLayer and your agent's sign-in unless you [keep them in volumes](install.md#without-a-screen). |
| `devcontainer up` hangs for a second container | Start containers one after the other. |
| You delete a machine or container | Remove it under Settings › Machines first, with **Also release its licence activation** ticked. |

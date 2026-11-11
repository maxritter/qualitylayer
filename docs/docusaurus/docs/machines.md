---
title: Machines
description: Run agents on a Mac Mini, a server or VS Code dev containers, and manage them from the App on your laptop.
---

The App on your laptop can run tasks on other computers you reach over ssh: a Mac Mini, a Linux server or a dev container. Agents there keep working while your laptop sleeps. You choose the machine in the sidebar's head and work in its pages as you do on your laptop.

**You need** a macOS or Linux machine with Git, your repository and your coding agent, and ssh from your laptop with a key. QualityLayer never asks for a password and stores none.

## A Mac Mini or any second machine {#second-machine}

1. On the machine, turn on ssh. On a Mac, that is **Remote Login** under System Settings › General › Sharing. On Linux, install `openssh-server`.
2. On your laptop, let ssh in with your key and give the machine a short name:

   ```bash
   ssh-keygen -t ed25519          # only if you have no key yet
   ssh-copy-id you@mac-mini.local
   ```

   ```text title="~/.ssh/config"
   Host mac-mini
     HostName mac-mini.local
     User you
   ```

3. Run `ssh mac-mini true` once and accept the host key. It must return without a question; the App never answers one.
4. On the machine, start your coding agent once and sign in.
5. In the App, open **Settings › Machines › Add machine**, pick `mac-mini` and choose **Install and add**. The App installs the `qualitylayer` command there, activates your licence key on it and connects.
6. Choose **mac-mini** in the sidebar's head. Its Setup page takes your project as a typed path, such as `/Users/you/code/api`. Start a task as you do on your laptop.

A question or a Plan waiting on the machine shows as a count on the sidebar's head while you work elsewhere. A machine counts as one of your licence's 5 computers.

## VS Code dev containers {#dev-containers}

Each dev container becomes its own machine with its own ssh port. Add an ssh server and your public key to the project's `.devcontainer/devcontainer.json`:

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

Give every container its own port on your laptop: `2223`, `2224` and so on. Then:

1. Start the container: **Reopen in Container** in VS Code, or `devcontainer up --workspace-folder .` from the [Dev Container CLI](https://github.com/devcontainers/cli). Start several containers one after the other.
2. Name it in `~/.ssh/config` and accept its host key with `ssh api-devcontainer true`:

   ```text title="~/.ssh/config"
   Host api-devcontainer
     HostName 127.0.0.1
     Port 2223
     User vscode
   ```

3. In the App, add `api-devcontainer` under **Settings › Machines**, choose it in the sidebar's head and add `/workspaces/api` as its project.

A rebuilt container has a new host key: run `ssh-keygen -R "[127.0.0.1]:2223"` and `ssh api-devcontainer true` again. A rebuild also removes QualityLayer and your agent's sign-in unless you [keep them in volumes](install.md#without-a-screen). Before you delete a container, remove it under **Settings › Machines** with **Also release its licence activation** ticked, so it no longer counts against your licence.

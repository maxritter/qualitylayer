---
title: Install
description: Use QualityLayer in the desktop App or your browser, with your task and coding agent side by side.
---

![One rule: a machine with a screen gets the App, which updates itself; WSL2, dev containers and servers get the command line and open the App in a browser](pathname:///img/diagrams/install-light.svg)
![One rule: a machine with a screen gets the App, which updates itself; WSL2, dev containers and servers get the command line and open the App in a browser](pathname:///img/diagrams/install-dark.svg)

**You need** macOS, Windows or Linux, Git, a repository, and Claude Code, Codex, Cursor, Grok, Antigravity, Pi, OpenCode or [another agent](agents/other.md) that you have signed in to and started once. See [native agent setup](agents/native.md) for supported versions and commands.

## On your computer

**[Download the App](https://qualitylayer.dev/download)** and open it. Setup asks for:

1. **Licence:** activate yours, or start the 7-day trial.
2. **Command line:** the App installs the `qualitylayer` command, skills and hooks.
3. **Your agents:** each of the seven supported agents is shown with its sign-in and plan, and connected when found on this computer. One that is missing offers **Install…**, which opens the vendor's install page or shows the command for you to run.
4. **Your projects:** the repositories your agents worked in lately, found in their own history on this computer. Those with a conversation in the last 14 days start checked; **Open QualityLayer** adds the checked ones.
5. **Your level:** Engineering (default) or Product. [What each changes](intro.md#two-levels).

On Windows you can also run `irm https://qualitylayer.dev/install.ps1 | iex` in PowerShell. This installs the App and the command line.

## In your browser {#browser}

The browser shows the same workspace: task content on the left, your agent on the right. After installation, run `qualitylayer app` to open it. Your agents run on the computer where QualityLayer is installed.

### WSL2, dev containers and servers {#without-a-screen}

Install QualityLayer where your agent runs. Its pages open in your computer's browser, so you don't need the App there.

![Install QualityLayer where your agent runs, in a dev container, WSL2 or on a server. Its pages open in the browser on your computer through one forwarded port](pathname:///img/diagrams/remote-light.svg)
![Install QualityLayer where your agent runs, in a dev container, WSL2 or on a server. Its pages open in the browser on your computer through one forwarded port](pathname:///img/diagrams/remote-dark.svg)

Install your agent first, then run this where it runs:

```bash
curl -fsSL https://qualitylayer.dev/install.sh | bash
```

| Your agent runs in | The App's pages open |
| --- | --- |
| **WSL2** | In your Windows browser |
| **A VS Code dev container** (on macOS, Windows or Linux) | In your browser. VS Code forwards the port |
| **A server over SSH** | In VS Code Remote-SSH, by themselves. With plain `ssh`, forward the port that `qualitylayer app pair` prints |

`qualitylayer app` opens the pages again at any time. An App installed on your computer shows only that computer's tasks.

### A port for each machine {#port}

QualityLayer's server listens on port 41888 of the machine it runs on, and only on that machine. Plain `ssh -L`, VS Code and most forwarding tools carry that port to your computer. If something else already uses 41888, the server takes the next free port (41889, 41890 and so on) and **Settings › About › Server** says which one. On WSL2 the first port is 41910, so it stays clear of the Windows App.

Reaching several remote machines from one laptop is where the default stops working: two machines cannot both be forwarded to port 41888 on your laptop, and some forwarding tools cannot send a remote port to a different port on your laptop. Give each machine its own port, and forward each machine's port to the same number on your laptop.

Say you have three servers for three isolated projects. On each one, pick a port from 1024 to 65535 and restart the server:

```bash
qualitylayer settings set cockpit.port 41901   # on the first server; 41902 on the second, 41903 on the third
qualitylayer app restart
```

From your laptop, forward the three ports. With plain `ssh`:

```bash
ssh -N -L 41901:127.0.0.1:41901 first-server
ssh -N -L 41902:127.0.0.1:41902 second-server
ssh -N -L 41903:127.0.0.1:41903 third-server
```

Then open `http://127.0.0.1:41901`, `:41902` and `:41903` in your browser. `qualitylayer app pair` on each server prints the link that signs your browser in, with that server's port. The setting is saved on that machine and survives updates and restarts.

To try a port once, without saving it, start the server with it: `QUALITYLAYER_PORT=41901 qualitylayer app restart`. The variable wins over the setting for that server only. A value that is not a port from 1024 to 65535 is ignored.

`qualitylayer app status` says which port the server listens on, and whether it had to take another one. You can also change the port in **Settings › About › Server**; the browser tab you used gets a link to the new port ([Settings](reference/settings.md#server)).

To keep your licence, Claude Code login and QualityLayer setup when the container is rebuilt, add this to `devcontainer.json`:

```json
"mounts": [
  "source=qualitylayer-${devcontainerId},target=/home/vscode/.qualitylayer,type=volume",
  "source=claude-${devcontainerId},target=/home/vscode/.claude,type=volume"
],
"postCreateCommand": "sudo chown vscode ~/.qualitylayer ~/.claude && curl -fsSL https://claude.ai/install.sh | bash && curl -fsSL https://qualitylayer.dev/install.sh | bash"
```

## Updates {#updates}

The App checks for updates every hour while running and downloads new versions in the background. Click **Update ready** in the sidebar, then **Restart and update**. Without the App, run `qualitylayer update`. Read the [changelog](https://qualitylayer.dev/docs/changelog).

**Settings › About › Update channel** chooses what you are offered. **Stable** (the default) takes stable releases only. **Beta** also takes betas, and moves to each stable release once it is newer than your beta, so switching never takes you back to an older version. `qualitylayer update` follows the same channel. An installed beta counts as Beta until you choose.

Setup connects the supported agents it finds. Updates preserve unrelated skills and your agents' personal settings.

## Remove it {#uninstall}

`qualitylayer uninstall` undoes what the installer changed; your plans stay. To move your licence, run `qualitylayer licence activate <key>` on the other computer.

### On Windows {#uninstall-windows}

Works even when the App or CLI is blocked or gone:

```powershell
& ([scriptblock]::Create((irm https://qualitylayer.dev/install.ps1))) -Uninstall
```

It removes QualityLayer's integrations from your coding agents (keeping a backup of changed files), plus the skills, App and shortcuts. Your native logins, settings and session history stay. Your licence and tasks stay; add `-Purge` to remove QualityLayer's data too.

## Windows with Intune or Defender Exploit Guard {#managed-windows}

If setup fails with "Microsoft Defender Exploit Guard blocked an operation that was not allowed by your IT administrator", or files vanish after install: QualityLayer 12.1.0's Windows installer and programs have verified publisher signatures. A managed-device policy may still block them. Ask IT to check the signature, release checksum and policy that blocked the file.

| Fix | How |
| --- | --- |
| **Exclusion** (IT) | Exclude `%LOCALAPPDATA%\QualityLayer` and `%USERPROFILE%\.qualitylayer\bin`. Intune: Endpoint security › Attack surface reduction › *Attack Surface Reduction Only Exclusions* |
| **File indicator** (IT) | Allow the setup file by its SHA-256 from `SHA256SUMS` on the release page |
| **WSL** (no IT) | Install [in WSL2](#without-a-screen); the App opens in your Windows browser |

Then run `qualitylayer doctor` and open the App once to repair the install.

Next: [your first task](first-task.md).

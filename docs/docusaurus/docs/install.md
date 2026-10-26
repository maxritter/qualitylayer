---
title: Install
description: Use QualityLayer in the desktop App or your browser, with your task and coding agent side by side.
---

![One rule: a machine with a screen gets the App, which updates itself; WSL2, dev containers and servers get the command line and open the App in a browser](pathname:///img/diagrams/install-light.svg)
![One rule: a machine with a screen gets the App, which updates itself; WSL2, dev containers and servers get the command line and open the App in a browser](pathname:///img/diagrams/install-dark.svg)

**You need** macOS, Windows or Linux, Git, a repository and a [supported](agents/native.md) or [other](agents/other.md) coding agent you have signed in to and started once.

## On your computer

**[Download the App](https://qualitylayer.dev/download)** and open it. Setup asks for your licence (or a 7-day trial), installs the `qualitylayer` command, connects the agents it finds, adds the repositories they worked in lately, and lets you pick Engineering or Product ([two levels](intro.md#two-levels)).

On Windows, you can also run `irm https://qualitylayer.dev/install.ps1 | iex` in PowerShell. This installs the App and the command line.

## In your browser {#browser}

`qualitylayer app` opens the same workspace in your browser. Agents run where QualityLayer is installed.

### WSL2, dev containers and servers {#without-a-screen}

![Install QualityLayer where your agent runs, in a dev container, WSL2 or on a server. Its pages open in the browser on your computer through one forwarded port](pathname:///img/diagrams/remote-light.svg)
![Install QualityLayer where your agent runs, in a dev container, WSL2 or on a server. Its pages open in the browser on your computer through one forwarded port](pathname:///img/diagrams/remote-dark.svg)

Install QualityLayer where your agent runs; no App is needed there.

```bash
curl -fsSL https://qualitylayer.dev/install.sh | bash
```

| Your agent runs in | The pages open |
| --- | --- |
| **WSL2** | In your Windows browser |
| **A VS Code dev container** | In your browser; VS Code forwards the port |
| **A server over SSH** | In VS Code Remote-SSH by themselves. With plain `ssh`, forward the port that `qualitylayer app pair` prints |

<details>
<summary>Keep your setup when a dev container is rebuilt</summary>

```json
"mounts": [
  "source=qualitylayer-${devcontainerId},target=/home/vscode/.qualitylayer,type=volume",
  "source=claude-${devcontainerId},target=/home/vscode/.claude,type=volume"
],
"postCreateCommand": "sudo chown vscode ~/.qualitylayer ~/.claude && curl -fsSL https://claude.ai/install.sh | bash && curl -fsSL https://qualitylayer.dev/install.sh | bash"
```

</details>

### A port for each machine {#port}

The server listens on port 41888 (41910 on WSL2), or the next free one. Two remote machines cannot both forward to 41888 on your laptop, so give each its own:

```bash
qualitylayer settings set cockpit.port 41901   # on the server
qualitylayer app restart
ssh -N -L 41901:127.0.0.1:41901 first-server   # on your laptop
```

Then open `http://127.0.0.1:41901`. `QUALITYLAYER_PORT=41901 qualitylayer app restart` tries a port once without saving it ([Server settings](reference/settings.md#server)).

## Updates {#updates}

The App updates itself: click **Update ready**, then **Restart and update**. Without the App, run `qualitylayer update`. Choose **Stable** or **Beta** in [Settings › About](reference/settings.md#about); see the [changelog](https://qualitylayer.dev/docs/changelog).

## Remove it {#uninstall}

`qualitylayer uninstall` undoes what the installer changed; your plans stay. To move your licence, run `qualitylayer licence activate <key>` on the other computer.

### On Windows {#uninstall-windows}

This works even when the App or CLI is blocked or gone. Your logins, licence and tasks stay; add `-Purge` to remove QualityLayer's data too.

```powershell
& ([scriptblock]::Create((irm https://qualitylayer.dev/install.ps1))) -Uninstall
```

## Windows with Intune or Defender Exploit Guard {#managed-windows}

If Defender Exploit Guard blocks setup or files vanish after install, a managed-device policy is blocking QualityLayer's signed 12.1.0 files.

| Fix | How |
| --- | --- |
| **Exclusion** (IT) | Exclude `%LOCALAPPDATA%\QualityLayer` and `%USERPROFILE%\.qualitylayer\bin` (Intune: *Attack Surface Reduction Only Exclusions*) |
| **File indicator** (IT) | Allow the setup file by its SHA-256 from `SHA256SUMS` on the release page |
| **WSL** (no IT) | Install [in WSL2](#without-a-screen) |

Then run `qualitylayer doctor` and open the App once.

Next: [your first task](first-task.md).

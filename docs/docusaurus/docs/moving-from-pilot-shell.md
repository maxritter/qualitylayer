---
title: From Pilot Shell 11
description: Use QualityLayer alongside Pilot Shell 11 and move at your own pace.
---

QualityLayer is a separate product. Version 11 is the last version called Pilot Shell. Keep using it as long as you like, or run both side by side. Installing QualityLayer leaves Pilot Shell, its configuration and its tools in place.

## Update from Pilot Shell

Run `pilot update` in a terminal. Pilot Shell shows the update from v11 to v12 with its release notes and asks **Update now?**. When you confirm:

1. QualityLayer's installer starts and says that Pilot Shell is now QualityLayer and keeps working.
2. On a Mac, or Linux with a screen, it installs the QualityLayer App and its command line. Over SSH, in WSL or in a container, it installs the command line alone.
3. It adds the QualityLayer skills to each agent it finds, such as Claude Code and Codex. Every download is checked against the signed release before anything is written.
4. The App opens to finish setting up. If it cannot open a window, the installer says where the App is.

You can also [install QualityLayer](install.md) directly; the result is the same.

## Start using QualityLayer

Ask your agent to plan or implement using QualityLayer or QL.

| Your licence | What to do |
| --- | --- |
| Active Polar-issued Pilot Shell licence | Nothing. It works with both products under its existing subscription terms |
| Older Gumroad purchase, or a key QualityLayer does not recognise | Email [hello@qualitylayer.dev](mailto:hello@qualitylayer.dev) from your purchase address. Keep the key private |
| None active | Start a fresh seven-day trial, even if you used a Pilot Shell trial |

Your repositories, code and Pilot plans stay where they are. To reuse a plan’s text, choose **Existing plan** in a new Feature or Bugfix; the old task’s workflow state is not imported.

## Import memories per project

Memories are the only data you need to import. Open **Settings → Memory → Import from Pilot Shell**, select the matching project, then choose its JSONL or Markdown files from `.pilot/memories/` in that repository. Each memory's project name must match.

Lessons are copied into QualityLayer's private project memory; your files stay in place, and a second import skips unchanged lessons ([Pilot memory import](memory.md#import-pilot-lessons)).

## Remove Pilot Shell when you are ready

Once your workflows work in QualityLayer, you can remove Pilot Shell with its own uninstaller:

```bash
curl -fsSL https://raw.githubusercontent.com/maxritter/qualitylayer/main/uninstall.sh | bash
```

It asks before removing anything and keeps the tools Pilot Shell installed; add `--remove-tools` to remove those too. QualityLayer does not run it or remove Pilot Shell's tools for you.

Next: [your first QualityLayer task](first-task.md).

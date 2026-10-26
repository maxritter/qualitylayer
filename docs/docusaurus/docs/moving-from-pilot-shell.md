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

Ask your agent to plan or implement using QualityLayer or QL. QualityLayer checks paid licences with Polar. An active Polar-issued Pilot Shell licence works with both products under its existing subscription terms.

For an older Gumroad purchase, or a key QualityLayer does not recognise, email [hello@qualitylayer.dev](mailto:hello@qualitylayer.dev) from your purchase address for help moving your licence. Keep the licence key private.

Without an active licence, you can start a fresh seven-day QualityLayer trial, even if you already used a Pilot Shell trial.

Your repositories, code and Pilot plans stay where they are. To reuse a plan’s text, choose **Existing plan** in a new Feature or Bugfix. This starts a QualityLayer task from that plan; it does not import the old task’s workflow state.

## Import memories per project

In QualityLayer, open **Settings → Memory → Import from Pilot Shell**. Select the matching project, then choose its Pilot memory files from `.pilot/memories/` in that repository. The importer accepts JSONL and Markdown files, and each memory's project name must match the selected project.

The import copies lessons into QualityLayer's private project memory. Your source files stay in place, and unchanged lessons are skipped on a second import. Memories are the only data you need to import. See [Pilot memory import](memory.md#import-pilot-lessons) for file formats and the CLI command.

## Remove Pilot Shell when you are ready

Once your workflows work in QualityLayer, you can remove Pilot Shell with its own uninstaller:

```bash
curl -fsSL https://raw.githubusercontent.com/maxritter/qualitylayer/main/uninstall.sh | bash
```

It asks before removing anything and keeps the tools Pilot Shell installed; add `--remove-tools` to remove those too. QualityLayer does not run it or remove Pilot Shell's tools for you.

Next: [your first QualityLayer task](first-task.md).

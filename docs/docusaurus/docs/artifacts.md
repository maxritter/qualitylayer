---
title: Artifacts
description: Create and review mockups, diagrams and clickable pages with your agent, then keep and share them.
---

An artifact is a mockup, diagram or clickable set of pages you work on with your agent. A **draft** belongs to one task; a **lasting artifact** is kept for the project.

![Ask for an artifact, open its compact entry in Files and comment on a spot. Share it when you choose.](pathname:///img/diagrams/artifacts-light.svg)
![Ask for an artifact, open its compact entry in Files and comment on a spot. Share it when you choose.](pathname:///img/diagrams/artifacts-dark.svg)

## Create and review

Ask “Using QL, show two layouts for the settings page.” No workflow starts. A task's draft appears as a compact entry in **Files**.

![A backend request diagram in QualityLayer’s artifact viewer, showing the gateway, stores and outside services](pathname:///img/app/artifact-light.webp)
![A backend request diagram in QualityLayer’s artifact viewer, showing the gateway, stores and outside services](pathname:///img/app/artifact-dark.webp)

*Example artifacts and people are fictional.*

### Comment on a spot {#full-size}

Press **C**, click a spot and say what should change; your agent edits the page and answers in the thread. Switch **Light**, **Dark**, **Desktop** and **Phone**; **F** goes full screen. Buttons and links work, and pages may run their own scripts, but nothing loads from the network. Your agent checks each page in both themes and widths before you see it.

## The Artifacts place {#artifacts-place}

![The artifact Library, grouped by project, with search, Favorites, List and Gallery views](pathname:///img/app/artifacts-light.webp)
![The artifact Library, grouped by project, with search, Favorites, List and Gallery views](pathname:///img/app/artifacts-dark.webp)

**Artifacts** in the sidebar holds the **Library**: filter **Yours** or **Shared with you**, switch **List** or **Gallery**, star **Favorites**. The row menu renames, copies, archives or deletes; **Archived › Recently deleted** restores.

## Lasting artifacts {#lasting}

![A lasting artifact, acme/platform's Backend: how a request travels through the gateway to its stores, with Feedback, The agent and Share in its header](pathname:///img/app/artifacts-open-light.webp)
![A lasting artifact, acme/platform's Backend: how a request travels through the gateway to its stores, with Feedback, The agent and Share in its header](pathname:///img/app/artifacts-open-dark.webp)

### Keep a draft {#keep}

**Keep as a lasting artifact…** stores it **In the repository** (travels with commits) or **Only on this computer** (out of Git). To change a lasting artifact, ask your agent to draft on it; to restore a revision, ask too.

### Fold in at Review {#fold-in}

The original stays until Review shows **This task changes …**: pick the pages (**Compare** shows both), then **Fold pages in**. They join the pull request.

## Share {#team-shared}

With a Team plan, **Share › Team** opens the real pages in teammates' Apps. Every save keeps a version.

| Access | Can |
| --- | --- |
| **Owner** | Edit, manage access, restore from **Version history…**, stop sharing |
| **Can edit** | Comment, save versions with **Save for the team**, ask their agent to restore one |
| **Can comment** | Open pages and leave feedback |

### Share a preview {#never-shared}

For a lasting artifact, open **Share › Outside link**, choose pages and **Create link**. Anyone with the whole link can read its previews and leave feedback without an account. Use **Update link** to publish later edits or **Revoke** to end access. Links last 14 days.

For a task draft, **Share › Include artifacts** adds previews to the task’s share. Shared previews are read-only. Ending sharing cannot remove copies already downloaded ([privacy](reference/files.md#privacy)).

[Artifact commands](reference/commands.md#artifacts).

---
title: Pull request
description: Choose to open a pull request from Review, then follow its checks and reviewers until you merge it.
---

![The workflow, with Pull request highlighted](pathname:///img/diagrams/track-pull-request-light.svg)
![The workflow, with Pull request highlighted](pathname:///img/diagrams/track-pull-request-dark.svg)

Open a pull request from [Review](review.md#approve). QualityLayer follows its checks and comments; you control the merge.

![The pull request: two review threads and a failing check wait on you, above its checks and reviewers](pathname:///img/app/pull-request-light.webp)
![The pull request: two review threads and a failing check wait on you, above its checks and reviewers](pathname:///img/app/pull-request-dark.webp)

*Example task in a fictional project.*

## Following it {#following}

The Review page shows the checks and reviewers, read through `gh` while the App is open. Without `gh`, the task closes at the approval.

## Your agent watches the checks {#watch}

The agent runs `qualitylayer pr watch` until the checks pass:

| Result | What your agent does |
| --- | --- |
| A check fails | Reads the log, fixes the cause, pushes, watches again. Never weakens or skips a check |
| The branch conflicts | Merges or rebases the way your repository does, then pushes |
| Three attempts used | Reports what still fails and stops |

It never force-pushes commits that are not its own.

## When something waits for you {#waits}

![Review threads and failing checks come back to you; you push the fix; you merge](pathname:///img/diagrams/pull-request-light.svg)
![Review threads and failing checks come back to you; you push the fix; you merge](pathname:///img/diagrams/pull-request-dark.svg)

With the App open, failing checks, change requests and conflicts appear in **Needs you**. They wake or resume your agent when [Watch pull requests](../reference/settings.md#git-and-editor) is enabled.

A new review thread or failing check moves the task to **Needs attention**:

1. Ask your agent: “Using QL, review task retry-webhooks”, naming your actual task.
2. Your agent checks each thread against the code and the approved Plan. It fixes a routine, in-scope request itself, test first. It asks you only when a thread would change the scope or design, or when a reply is ready to post.
3. Press **Push the fix**. Your answers post on GitHub in your name.

For review threads, pushing the fix and replying to reviewers stay yours, and so does merging.

## Merged or closed {#merged}

When you merge, the task moves to **Shipped** with what it cost. Its documents stay in `docs/plans/`.

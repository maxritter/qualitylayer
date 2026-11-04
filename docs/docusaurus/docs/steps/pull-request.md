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

While the App is open, Review reads checks and reviewers through `gh`. Without it, the task stays open until a pull or fetch brings the merge to local Git, or you mark it merged.

## Your agent watches the checks {#watch}

The agent runs `qualitylayer pr watch` until the checks pass:

| Result | What your agent does |
| --- | --- |
| The checks pass | Checks open review threads and reads new comments. Asks you before changing anything they request |
| A check fails | Reads the log, fixes the cause, pushes, watches again. Never weakens or skips a check |
| The branch conflicts | Merges or rebases the way your repository does, checks that no commit was lost, then pushes |
| Three attempts used | Reports what still fails and stops |

It never force-pushes commits that are not its own.

## When something waits for you {#waits}

![Review threads and failing checks come back to you; you push the fix; you merge](pathname:///img/diagrams/pull-request-light.svg)
![Review threads and failing checks come back to you; you push the fix; you merge](pathname:///img/diagrams/pull-request-dark.svg)

Failing checks, review threads and conflicts appear in **Needs you** while the App is open. [Watch pull requests](../reference/settings.md#git-and-editor) can wake or resume your agent, also for reviewers' new comments. To handle them:

1. Ask your agent: “Using QL, review task retry-webhooks”, naming your actual task.
2. Your agent checks the code and approved Plan, then fixes routine requests test first. Scope or design changes and replies ready to post come to you.
3. Press **Push the fix**. Your answers post on GitHub in your name.

For review threads, pushing the fix and replying to reviewers stay yours, and so does merging.

## Merged or closed {#merged}

When you merge, the task moves to **Shipped** with what it cost. A squash or rebase merge is recognized too, and **Mark as merged** covers any other case. Its documents stay in `docs/plans/`. Further work starts with **Start a follow-up**.

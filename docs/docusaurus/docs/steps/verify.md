---
title: Verify
description: The project checks, then a fresh agent that did not write the code rules on every Done means point, with evidence.
---

![The seven steps, with Verify highlighted](pathname:///img/diagrams/track-verify-light.svg)
![The seven steps, with Verify highlighted](pathname:///img/diagrams/track-verify-dark.svg)

Verify starts when the build session says the build is ready. It proves the change with recorded evidence and asks you nothing; whatever stays open goes to Review. Nothing is marked passed without evidence. The page is titled **Whether it works**.

![Verify in the App: the checks and their results](pathname:///img/app/verify-light.webp)
![Verify in the App: the checks and their results](pathname:///img/app/verify-dark.webp)

*Example task in a fictional project.*

## The checks {#lanes}

Every change gets the same checks, small ones included.

| Check | What it does |
| --- | --- |
| **Security review** | First, when the Plan names a trust boundary such as sign-in, secrets or outside input. A separate agent reviews the change; your agent fixes what it finds. Medium and low findings go into the pull request |
| **Project checks** | Your tests, types, lint and build, run on the committed build and recorded. A red check is a record, not a stop: the reviewer rules on it |
| **Independent review** | One fresh agent that did not write the code. It adds the tests the build missed, runs the scenarios on the running program and compares changed screens with their artifacts. It reads the whole diff and records a verdict for every **Done means** point. Red checks are its evidence |
| **Second opinion** | Beside the independent review on a risky change, or always when [Settings](../reference/settings.md#second-opinion) say so. A separate reviewer checks for breakage. Your agent answers each finding **Taken** or **Kept** |

If you turn **Independent review** off in [Settings](../reference/settings.md#independent-review), no fresh agent checks the change; Verify records **Checked without an independent judge**.

## Two runs {#rounds}

If the independent review finds gaps, your agent fixes them and commits. A second fresh reviewer then rechecks what failed and what the fix touched. That is the limit: two runs.

What is still open afterwards goes to Review with the open items first, from either reviewer and from the second opinion. **Fix open items** there runs one more round on just those items.

## Proof for each point {#live}

Each **Done means** point shows its evidence as it comes in: output, a screenshot or a file. Failed and blocked points come first; open a check for its commands and output.

## What reaches Review {#when-it-stops}

Failed checks keep their results and evidence. Prerequisites only you can provide, unavailable environments and points still open after the second run reach Review as unresolved work. They never count as passed.

Your agent's native permissions and your explicit stop or pause still apply.

Next: [Review](review.md).

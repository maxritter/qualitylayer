---
title: Verify
description: Run project checks and independent review against the approved Plan.
---

![The seven steps, with Verify highlighted](pathname:///img/diagrams/track-verify-light.svg)
![The seven steps, with Verify highlighted](pathname:///img/diagrams/track-verify-dark.svg)

Your agent runs checks and independent review, then fixes the findings. Unresolved work reaches Review with its evidence; approval never marks it passed.

![Verify in the App: the checks and their results](pathname:///img/app/verify-light.webp)
![Verify in the App: the checks and their results](pathname:///img/app/verify-dark.webp)

*Example task in a fictional project.*

## The checks {#lanes}

Project commands and security scans produce recorded results. Separate agents review the code and its behavior.

![Project checks: tests and types, linters, code health and recorded proof. Independent agents: security review, independent review, design review and an optional second opinion.](pathname:///img/verify/verification-light.webp)
![Project checks: tests and types, linters, code health and recorded proof. Independent agents: security review, independent review, design review and an optional second opinion.](pathname:///img/verify/verification-dark.webp)

**Project checks**

| Check | What it does |
| --- | --- |
| **Project checks** | Your tests, types, lint and build, run on the committed build and recorded. A red check is a record, not a stop: the reviewer rules on it |
| **Code health** | Complexity and duplication in the files your agent changed, reported to it after each turn as feedback. [Code health](../reference/code-health.md) |
| **Security scans** | Local scans for secrets, dependency advisories, GitHub workflows and risky code. Unavailable scans stay **not checked**. [Security scans](../reference/code-health.md#security-scans) |
| **Recorded proof** | A **Done means** point passes only with evidence: a check's output, a captured response, a screenshot or a file |

**Independent agents**

| Check | What it does |
| --- | --- |
| **Security review** | Runs beside the project checks when the change crosses a trust boundary or edits agent controls. Your agent fixes critical and high findings before independent review; remaining findings stay visible |
| **Independent review** | An agent that did not write the code. It adds the tests the build missed, runs the scenarios on the running program and compares changed screens with their artifacts. It reads the whole diff and records a verdict for every **Done means** point. Red checks are its evidence |
| **Design review** | A separate agent checks each finished design before you see it, unless you change **Design review** in [Settings](../reference/settings.md) |
| **Second opinion** | On risky changes when enabled in [Settings](../reference/settings.md#second-opinion), or when requested, a reviewer from another agent family checks for breakage. Your agent records each finding as **Taken** or **Kept** |

If you turn **Independent review** off in [Settings](../reference/settings.md#independent-review), no fresh agent checks the change; Verify records **Checked without an independent judge**.

## Two runs {#rounds}

If the independent review finds gaps, your agent fixes them and commits. A second reviewer rechecks the failures and affected code. That is the limit: two runs.

What remains open stays visible in Review. Use **Give feedback** to ask for a fix; your agent rechecks the affected work.

## Proof for each point {#live}

Each **Done means** point shows its evidence as it comes in: output, a screenshot or a file. Failed and checking points come first, then those **yours to confirm**, then the rest. Open a check for its commands and output.

## What reaches Review {#when-it-stops}

Failed checks keep their results and evidence. Prerequisites only you can provide, unavailable environments and points still open after the second run reach Review as unresolved work. They never count as passed.

Your agent's native permissions and your explicit stop or pause still apply.

Next: [Review](review.md).

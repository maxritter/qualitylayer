---
title: Verify
description: Run project checks and independent review against the approved Plan.
---

![The seven steps, with Verify highlighted](pathname:///img/diagrams/track-verify-light.svg)
![The seven steps, with Verify highlighted](pathname:///img/diagrams/track-verify-dark.svg)

Your agent runs checks and independent review, then fixes the findings. Review opens once every point passes; a failure is never marked passed. The page shows only a summary and the checks; the findings, commands and every judged round are in `agents/06-verify.md`.

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
| **Project checks** | Tests, types, lint and build run on the commit. Failures are recorded without stopping the workflow; the reviewer rules on them |
| **Code health** | Complexity and duplication in the files your agent changed, reported to it after each turn as feedback. [Code health](../reference/code-health.md) |
| **Security scans** | Local scans for secrets, dependency advisories, GitHub workflows and risky code. Unavailable scans stay **not checked**. [Security scans](../reference/code-health.md#security-scans) |
| **Recorded proof** | A **Done means** point passes only with evidence: a check's output, a captured response, a screenshot or a file |

**Independent agents**

| Check | What it does |
| --- | --- |
| **Security review** | Runs beside the project checks when the change crosses a trust boundary or edits agent controls. Your agent fixes critical and high findings before independent review; remaining findings stay visible |
| **Independent review** | An agent that did not write the code reads the whole diff, adds missing tests, runs the program's scenarios and compares screens with their artifacts. It records a verdict for each **Done means** point, using red checks as evidence |
| **Design review** | A separate agent checks each finished design before you see it, unless you change **Design review** in [Settings](../reference/settings.md) |
| **Second opinion** | A reviewer from another agent family checks risky changes when [enabled](../reference/settings.md#second-opinion), or on request. Findings are recorded as **Taken** or **Kept** |

If you turn **Independent review** off in [Settings](../reference/settings.md#independent-review), no fresh agent checks the change; Verify records **Checked without an independent judge**.

## Two fix rounds {#rounds}

If the independent review finds gaps, your agent fixes them and commits. A fresh reviewer rechecks the failures and affected code, running only the checks the fix touches. That can happen twice; a round that fixes nothing ends them early.

## Proof for each point {#live}

Each **Done means** point shows its evidence as it comes in: output, a screenshot or a file. Failed and checking points come first, then those **yours to confirm**, then the rest. Open a check for its commands and output.

## When Verify cannot finish {#when-it-stops}

Failures keep their evidence. A point still failing after the second fix round, a prerequisite only you can supply or an unavailable environment ends Verify with one question: change what **Done means** says, ask for one more fix round, or stop the task. Work outside the task becomes a follow-up with its owner. No answer marks a failing point as passed.

Your agent's native permissions and your explicit stop or pause still apply.

Next: [Review](review.md).

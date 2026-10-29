---
title: Code health and security scans
description: Your agent gets feedback on complex and duplicated code, leaked secrets, vulnerable packages, unsafe GitHub workflows and risky code, checked on your computer.
---

QualityLayer checks code on your computer and hands the findings to your agent and the reviewers. Code health finds complex and duplicated code. Security scans find leaked secrets, vulnerable or malicious packages, unsafe GitHub workflows and risky code. Neither ever stops the work.

![Edited code is checked locally. Your agent reads each finding, fixes a problem or records why the code should stay. Tests verify the change.](pathname:///img/diagrams/code-health-light.svg)
![Edited code is checked locally. Your agent reads each finding, fixes a problem or records why the code should stay. Tests verify the change.](pathname:///img/diagrams/code-health-dark.svg)

## What happens as you work

1. **You or your agent edits code.** At the end of the agent's turn, the edited files get a structure check and a secrets scan.
2. **Your agent gets the findings.** It reads the source and explains the consequence before changing anything.
3. **It fixes or reviews each finding.** A useful fix is checked with the affected tests. An intentional pattern keeps its review reason.

Checks do not start another agent turn. Findings reach it when the conversation next continues.

## Security scans {#security-scans}

In [Verify](../steps/verify.md#lanes), the scans read what the task changed, beside your project checks. Each one reads only the files it knows:

| Scan | Reads | Tool |
| --- | --- | --- |
| Secrets | Every changed file | Betterleaks |
| Dependencies | A changed lockfile | OSV-Scanner |
| GitHub workflows | A changed workflow or action | zizmor |
| Code | Changed JavaScript, TypeScript and Python | OpenGrep, with QualityLayer's rules |

The Security review starts from the findings; the Independent review rules on them. A scan with no file to read is **not needed**. A scan that could not read a file says **not checked**, never clean.

Verify scans what the task committed and its uncommitted edits to tracked files. A new file that was never added to git is not scanned there, but the secrets scan after each agent turn still reads it. A secret found in the task's own records, such as captured command output, is removed before it is committed.

**What leaves your computer:** only dependency advisories. When a lockfile changes, its package names and versions are checked against osv.dev. Choose **Local copy** in [Settings](settings.md#security-scans) to keep them here; the database is about 250 MB.

## What a finding means

| Finding | What your agent looks for |
| --- | --- |
| Complex function | Branches or responsibilities that make a change difficult to understand |
| Duplicated code | Copies that could drift apart; broader duplication checks run when you ask |
| Possible secret | A key or password in a file; a real one is moved out and rotated |
| Advisory | A package version with a known vulnerability or known malware |
| Previously seen | A finding the tool already reported; it still needs review |
| Acknowledged | A finding retained with a specific reason; the code has not been repaired |

A finding needs a new review when its function, the analyzer configuration or its duplicate changes, or when its metric goes up.

## Ask for a broader check

Try “Check this project's duplication”, “Review the complexity of the files we changed” or “Scan this branch for secrets.” Your agent can also run your project's enabled linters.

Code health and security scans are advisory. Your tests and release requirements still apply. A failed, skipped or unavailable check is never counted as passing.

[Commands and setup troubleshooting](commands.md#code-health) · [Supported agents](../agents/native.md)

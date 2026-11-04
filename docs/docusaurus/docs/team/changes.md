---
title: Change reviews
description: Review a finished change, its proof and code from your own Git remote.
---

At Review, teammates read the walkthrough, proof and unresolved checks. **Ask for review** adds code review and line comments ([details](../steps/review.md#team-review)).

![Change review: the team reviews the finished change; open threads go back to your agent, which settles each one and checks again what the fix touched before the re-review](pathname:///img/diagrams/team-change-light.svg)
![Change review: the team reviews the finished change; open threads go back to your agent, which settles each one and checks again what the fix touched before the re-review](pathname:///img/diagrams/team-change-dark.svg)

1. Teammates comment, approve or ask for changes.
2. Ask “Using QL, review task retry-webhooks”, naming your actual task, to settle each thread with your agent.
3. What a fix touched is checked again, and your team looks once more.
4. You approve.

## Reading the code together {#code}

**Ask for review** shows the remote, commits and selected teammates before you confirm the push. The shared task records the repository, branch and commits, encrypted with your team's key.

- A teammate with a checkout of the same repository reads the code there and comments on lines. Your Git remote decides who can read the code, as today.
- A teammate without a checkout, or without access to the remote, sees the walkthrough with file names.
- Comments sit on the lines they are about. You stay the one who approves the change.

Pull request threads and failing checks come back the same way ([Pull request](../steps/pull-request.md)). Shared tasks include no source files, diffs or host logs. A comment can quote a few lines of the code it is about ([What is shared](plans.md#privacy)). Review any text or attachments you add before sending.

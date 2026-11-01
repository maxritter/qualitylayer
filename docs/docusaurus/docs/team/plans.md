---
title: Plan reviews
description: With a Team plan, your team helps shape the Plan before any code, each in their own App, and people outside the team comment through a link.
---

With a Team plan, your team reviews the Plan before any code (this page) and the [finished change](changes.md).

![Two moments for your team: review the plan before any code, and review the finished change after the build](pathname:///img/diagrams/team-timeline-light.svg)
![Two moments for your team: review the plan before any code, and review the finished change after the build](pathname:///img/diagrams/team-timeline-dark.svg)

## Ask a teammate

![Plan review with your team: you ask a teammate about a part of the Plan, a Slack message opens it in their App, they answer, the answer reaches your agent, and you decide; a guest with a link can comment too](pathname:///img/diagrams/team-light.svg)
![Plan review with your team: you ask a teammate about a part of the Plan, a Slack message opens it in their App, they answer, the answer reaches your agent, and you decide; a guest with a link can comment too](pathname:///img/diagrams/team-dark.svg)

1. Select a passage and choose **Give feedback**. Pick a person in **To**, then choose **Before approval** or **Opinion only** and **Send**.
2. They open the request in Home's **Needs you** and write their answer to the fixed asker, or let [their agent draft it](agents.md).
3. Your agent updates the Plan. Only your approval moves the task on.

On a shared Plan or Review, **Looks right** sends your review to the owner. **Suggest changes** asks what should change before sending. **Give feedback** leaves a thread without requesting a decision. The owner decides when to approve the task.

## Share and reading status

**Share** holds team or group access, people with access, review requests, artifact inclusion and the outside link in one sheet. Seats are managed in Settings.

The task header shows who it waits on and offers **Remind**. **Seen by** names confirmed readers of the current shared version and opens the same Share sheet. **Not opened yet** appears only when reading data is known; otherwise the App shows no reading status.

## Slack and email {#slack}

The team owner connects Slack, turns on email, or both, in **Settings › Team**. Each person then controls:

- **Slack messages** and **Email messages** under **Away from this computer** in Settings › Notifications
- an optional **Morning digest**, sent by your computer's local time
- **Follow**, which subscribes you to a shared task's updates

Each message reaches you one way: in Slack when Slack finds your account and your Slack messages are on, otherwise by email if you turned it on. Questions and answers always appear in Team. If your emails differ, link your own Slack account in Settings. Slack controls do-not-disturb hours. Every email has a link that turns email off, and an address that bounces turns it off too.

## People outside your team {#outside-links}

**Share › Copy link** gives a qualitylayer.dev link. Anyone with it can read and comment without an account. The task owner decides approval.

- The open page updates as the task changes and keeps your unsent answers and comments.
- A link lasts 14 days; **Revoke** ends it at once.
- **Include artifacts** adds previews ([Artifacts](../artifacts.md#never-shared)).

If an update cannot be published, Share shows the problem and keeps the last complete copy. Shrink oversized content, then use **Retry sharing** for the team or **Renew** for an external link.

A coding agent can fetch the shared documents as Markdown, no licence needed:

```sh
qualitylayer share fetch --link-file /path/to/private-link.txt --out ./shared-copies --json
```

The file holds the whole link, including the part after `#`; keep it private ([details](../reference/commands.md#read-a-public-share)).

## What is shared {#privacy}

- Shared documents, artifacts and comment bodies are encrypted with your team's key before publication. The server stores only ciphertext.
- Slack messages and emails can include task titles and short question or answer excerpts, which pass through our server to Slack or to our email provider, Resend.
- Review code travels between your computer and your own Git remote. QualityLayer stores your team's encrypted comments, the short lines of code they quote (up to 300 characters each) and the commits and branch they point to.
- The shared task includes no source files, diffs or logs.

More in [Files and privacy](../reference/files.md#privacy).

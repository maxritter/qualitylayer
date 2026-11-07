---
title: Required lines
description: Make a check, tool or skill part of a workflow step, for yourself or your whole team.
---

# Required lines

Make a check, tool or skill part of a step. Your agent records each outcome, including why a line does not apply.

<figure class="memory-flow" aria-label="How a required line is recorded">
  <ol>
    <li><strong>Add a line</strong><span>A checkbox under a step's heading in your or your team's instructions.</span></li>
    <li><strong>The agent does it</strong><span>Each reply in that step lists it first. The agent records it done or skipped.</span></li>
    <li><strong>Read the record</strong><span>The instruction record keeps each outcome. Skips remain recorded.</span></li>
  </ol>
  <figcaption>Example: the team's Wiz scan runs in every teammate's Verify.</figcaption>
</figure>

```md
## Verify
- [ ] run: `wizcli dir scan --path .`
- [ ] Review auth changes with the threat-model skill
- Mention Wiz findings in the pull request.
```

| Line | What happens |
| --- | --- |
| `- [ ] run: …` under Implement, Verify or Review | A Project check: the Plan names it, approving the Plan covers running it, and [Verify](steps/verify.md) records its result |
| `- [ ]` with other words | The agent does it its own way, with a skill, an MCP tool or by hand, then records a note or a reason |
| `-` a plain bullet | Guidance, as before |

## Add one

- **App**: Settings › Workflow › **Your instructions** › **Steps**. The team's owner uses Settings › Team.
- **Your agent**: “Make a Wiz scan required in Verify.”
- **CLI**: `qualitylayer instructions add verify "<line>"`. See [Commands](reference/commands.md).

## What to expect

- A task keeps the lines it started with. An edit applies from your next task.
- Your agent is reminded once when it leaves a step with unrecorded lines. Missing records never count as passing evidence.
- Review lines are done before the final review opens. Put checks that must run under Verify.
- Your agent resolves failed or unavailable checks before Review, asking a question when only you can settle them. Unrun checks stay unrun in the record.
- Team lines come first, and teammates can't remove them. If a line cannot apply, your agent records the reason.
- Commands and connectors use the logins already on your computer. QualityLayer stores no credentials.

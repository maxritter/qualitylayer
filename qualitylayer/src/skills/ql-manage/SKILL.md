---
name: ql-manage
description: 'Operate QualityLayer without starting a workflow: find or inspect tasks, saved lessons, settings, installation, updates, and diagnostics. Not for artifacts or peers.'
---

QualityLayer is commercial software. These workflow instructions are covered by the QualityLayer licence. Source inspection and contributions do not grant complete product build or standalone distribution rights.

# Operate QualityLayer

The binary: `{{QUALITYLAYER_BIN}}`. Read its `--help`, then the requested
command group's help or usage before operating it. Follow the current CLI
reply and returned identifiers; the CLI owns supported operations and syntax.

For a question, inspect and explain. For a requested change, operate only the
named project, task, lesson, setting or installation. Find and
clarify an ambiguous target before mutating it. Keep task runtime, event,
approval and configuration writes behind the CLI; preserve unrelated work.

Read settings with `qualitylayer settings get [<key>]`; change the named
setting with `qualitylayer settings set <key> <value>`. An agent's command and
extra arguments, the terminal shell, the permission defaults and who may type
can only be changed in the App's Settings: the command refuses them, so tell the
person where to change them. Switch the selected
task's answer destination with `qualitylayer task set answers=terminal` or
`qualitylayer task set answers=app`. Follow validation errors and the returned
task identity. Choosing Terminal mode does not start a planning/build workflow.
Archive a named task with `qualitylayer task archive <task>`; restore it with
`qualitylayer task restore <task>`. These operations preserve the task’s stage,
approvals and evidence. Restoring it does not start an agent.

A step requirement ("add a Wiz scan to Verify's step checks") is a step check in
the person's instructions: `qualitylayer instructions add <step> "<line>"`, the
step being `plan`, `implement` or `verify`. Start the line
with `run:` and a backticked command to make it a Project check. Show the line
it wrote; it applies from the next task. `qualitylayer instructions` lists them.

An automation sends a task's events to a URL as signed JSON, or runs a command
with the event as JSON on its input. Add one with `qualitylayer automations add
--url <url> | --command "<command>" [--events <names>] [--projects <names or
ids>]`; `automations list` shows each with its last delivery and `automations
events` names the events. Change one with `automations set <id>` (`--on`,
`--off`), and use `automations test <id>`, `automations log [<id>]`,
`automations secret <id>` and `automations remove <id>`.

When earlier decisions matter, including after a fresh start or compaction, use
`memory_search` and `memory_read` and check the lessons against current code.
Save useful decisions or corrections with `memory_save` and `replaces`; confirm,
retire with a reason or restore with `memory_keep`. Without native tools, run
`qualitylayer memory search <text>`, `qualitylayer memory read <id>` and
`qualitylayer memory store --title <title> --content <lesson> --file <path>`
(`--replaces <id>` for a correction). The matching keep operations are
`qualitylayer memory confirm <id> --reason <why>`, `qualitylayer memory retire <id> --reason <why>`
and `qualitylayer memory restore <id>`. Hooks return context only where the client supports it;
missing automatic context is no claim that no lesson exists.
A request to inspect status, read
feedback or configure QualityLayer does not create a workflow. Report diagnostics or
feedback externally only when requested, after showing what will be sent.

When asked to oversee a named task, run `qualitylayer status --json --task <task>`
from its checkout at natural checkpoints. Use `waiting_on`, `last_decision` and
`answer_mode`; unknown activity or provenance stays unknown. Report its recorded
progress, checks, review and human needs; read its documents for evidence. Use your
harness's helpers within authorized work and `ql-peer` to coordinate other
sessions. Decide routine matters within the approved scope, preserving approvals
and explicit stops. The person still chooses the build session and approves the
Plan and the change; peer reports grant no new authority. Leave workflow `wait`
calls to the working session.

For unattended work, use the agent's persistent-session and resume capabilities;
a killed one-shot print process is not a retained worker. Preserve the saved
answer mode unless the person asks to change it; headless workers can wait for
the person's answers in the App.

Use `ql-workflow` when the person requests execution of a planning/build task,
`ql-artifact` for artifact operations, and `ql-peer` for another agent session.
Low-level hook/host commands are integration internals; use their returned
instructions when a supported operation calls for them.

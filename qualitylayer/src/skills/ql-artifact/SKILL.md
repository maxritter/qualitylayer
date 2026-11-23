---
name: ql-artifact
description: 'Create, open, edit, review, rename, copy, archive, or delete QualityLayer artifacts and address artifact feedback (standalone or workflow drafts). Does not start a coding workflow.'
---

QualityLayer is commercial software. These workflow instructions are covered by the QualityLayer licence. Source inspection and contributions do not grant complete product build or standalone distribution rights.

# QualityLayer artifacts

The binary: `{{QUALITYLAYER_BIN}}`. Use this path for `qualitylayer` commands.

Read `qualitylayer artifact guide` once before authoring or editing an artifact;
for an audit, read `qualitylayer artifact guide review`. Follow that guide and
the current CLI replies. The CLI owns the artifact procedure and project context.

Find the requested artifact with `qualitylayer artifact list`. Keep its project,
page and workflow association. If the target is ambiguous, ask which artifact.
“Open the current artifact” means the exact artifact being worked on in this
conversation, not another session's most recent artifact. Use
`qualitylayer artifact open <name> --page <page> --section <id-or-label>`;
omit unneeded flags, and add `--browser` to open it in the browser. Keep the
page and section the person asked for; a missing or ambiguous target needs
clarification instead of silently opening a different section.
For an existing artifact, `artifact inspect <name>` supplies its source, context
and current revision. Use that revision for guarded page writes. For a lasting
artifact's title, copy, archive, restore or deletion, use `artifact library inspect`
and its revision with `artifact library <action> --if-match <revision>`; read
the command's help for its title, destination and active-draft flags.
Use ordinary artifact operations for personal pages and task drafts; preserve source files the
registration points to. A request to delete an artifact authorizes that artifact,
not its project's application source.

In Terminal mode, use `qualitylayer artifact show <name> --page <page> --terminal` and
show its returned text sketch and screenshot path, or missing-Chrome guidance.
Keep `--open` and browser launches out of that path. Record typed feedback with
`qualitylayer artifact comments add <name> --page <page> --section <id> --asked
"<the person's exact words>"`; retain the requested page and section and follow
any verification refusal instead of guessing another target.

A standalone request stays in the project artifact workspace. For a workflow
artifact, keep the task's draft ancestry and approval boundaries. Read the
artifact's feedback, make the requested change, show it in QualityLayer, then
answer the addressed feedback through the CLI. Resolve a question or missing
anchor before changing a different part of the artifact.

When implementation is covered by a project's lasting App, backend, workflow or
website artifact, keep every affected model and its implementation in the same
change. Follow the project's model mapping and approval rules; give delegated
work explicit model ownership. Before marking the artifact built or handing
implementation back, compare it with the actual source and relevant rendered
states or contracts, update coverage and generated exports, and pass the
project's model checks. A changed status or matching hashes alone does not prove
parity. Review a changed design before implementing it; remaining drift is
unfinished work.

Verify an artifact with `qualitylayer artifact check <name> --render` and
`qualitylayer artifact shot <name> --matrix`. Wait for each command to exit, including
any yielded shell session, before editing its source or starting another render.
When `artifact list` or `inspect` reports
`tokens: drifted`, `qualitylayer artifact tokens <name>` shows what differs and
`--refresh --if-match <revision>` updates a draft.

Before you tell the person a finished design is ready, run
`qualitylayer artifact review <name> [--page <page>] [--request "<what they asked for>"]`.
It says when design review is off, the design is a wireframe or it was already
reviewed; otherwise it names a brief file. Give that file to a fresh subagent (about a
minute), save its report and record it with `--done --report <file>`, fix the findings
in one batch and confirm with your own screenshots. One round. A workflow's Plan step
runs this check itself.

Load another skill only for a distinct requested capability: `ql-workflow`
for a planning/build workflow, or `ql-peer` to contact another agent session.

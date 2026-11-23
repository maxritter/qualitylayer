---
name: ql-chat
description: 'Start or continue a QualityLayer Chat when explicitly asked (e.g. "Using QualityLayer, chat about …"). Not for ordinary requests, product discussion, or workflows.'
---

The binary: `{{QUALITYLAYER_BIN}}`

When earlier project decisions matter, search and read relevant lessons again after a fresh
start or compaction. Use `memory_search` and `memory_read`; save reusable corrections with
`memory_save` and `replaces`, and confirm, retire or restore with `memory_keep`. Without those
tools, use the matching `qualitylayer memory` commands described by `ql-manage`. A client without
an automatic lesson hook uses this same CLI fallback.

## Start or continue

For a new Chat (the prompt may say "start chat: <request>"), run
`{{QUALITYLAYER_BIN}} task start --type chat --json "<the person's request>"`.
For an existing Chat, select its exact task with `--task <slug>` on each command.
Read the result, then work with the person in the conversation. A Chat has no workflow
steps or approval gates. Keep the agent's native task list current and use its native
picker when a choice needs the person's answer. After your first reply, give the Chat
a short title with `{{QUALITYLAYER_BIN}} chat rename "<title>" --json`.

## Optional tools

Use these only when the person requests the corresponding work:

- **Save the plan:** `{{QUALITYLAYER_BIN}} chat plan save --file <local-markdown> --json`.
  Alternatively use `--text <markdown>`, exactly one input. Save ordinary Markdown;
  retain its wording and line endings. The result names `chat-plan.md` for the Reader.
- **Build in slices:** derive complete vertical slices from that saved plan in the
  same slices-and-cards grammar a task's build uses, with the complete slice file example below.
  Save this local Markdown file, then run `{{QUALITYLAYER_BIN}} chat build --file <cards-markdown> --json`.
  Start each returned helper as a fresh agent with only its `brief_file` path and
  "Read it in full and follow it". Respect file ownership and preserve other helpers'
  edits. Save every result with `helper result <id> --file <report>` and finish with
  `progress done --agent <id>`. Resume with `chat build`; check existing helpers before
  launching returned offers, inspect saved reports and tick only verified completed
  cards in `chat-slices.md`. With no helper running, it resumes unchecked slices.
  Completed and stopped reports remain on disk.
- **Checks:** `{{QUALITYLAYER_BIN}} chat check [--slice <n>] --json` prints the actual
  validation commands. Run those commands yourself under the session's existing
  permissions and retain each exit status. Printing a command does not prove it passed.
- **Independent review:** `{{QUALITYLAYER_BIN}} chat review --json` returns a fresh
  reviewer brief. Start that independent reviewer with only its `brief_file` path.
  Record the returned report with `{{QUALITYLAYER_BIN}} chat review --done --id <id> --report <local-report> --json`.
  If no fresh reviewer is available, state that limitation. Address concrete findings.
- **Artifacts:** use the `ql-artifact` skill for creating, changing and opening artifacts.

### Slice file example

Use this complete shape in the local file passed to `chat build --file`. Replace
the task, paths and commands to match the saved plan; retain the labels and nesting.
This example is for a Bun CLI project.

```markdown
## Slice 1: Add a version flag

- [ ] T1 Print the version
  - **Objective:** Print the current version when --version is passed.
  - **Files:** `src/cli.ts`, `tests/cli.test.ts`
  - **Test first:** Add a failing CLI test for --version.
  - **Done when:**
    - --version prints the current version and exits successfully.
    - verify: `bun test tests/cli.test.ts`

**Validation:** automated: `bun test tests/cli.test.ts` · manual: none
```

For more slices, repeat the block with card IDs T1, T2, … unique across the whole
file. Give every card its own backticked Files paths and `verify:` command, and
every slice its own Validation command.

## Convert to task

Only when the person requests it (the App's Convert to task), run
`{{QUALITYLAYER_BIN}} chat promote --type feature|bugfix --json`, choosing the kind
they asked for. Running slice helpers must finish or be explicitly stopped first;
stop the native helper through the agent's own controls, then record it with
`{{QUALITYLAYER_BIN}} chat build --stop <slice> --json`. Promotion keeps this task and conversation,
records the Chat plan, artifacts and changed files as the Plan's context, and is allowed
once. Follow its instruction to run `{{QUALITYLAYER_BIN}} next --json` and continue
with `ql-workflow` at the Plan. The Plan's approval governs subsequent work.

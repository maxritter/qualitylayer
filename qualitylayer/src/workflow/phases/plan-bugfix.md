## A bug's Plan

For a bug, the Plan is the diagnosis, the before and after and the fix, in one file. You diagnose it
yourself in this checkout: no helper starts. Everything above applies; these sections replace the
feature's list.

**Reproduce before you theorise.** Run the reproduction and read all of its output: warnings and log
lines above the failure often name the cause. When you cannot reproduce it, ask the person for the
missing conditions; never diagnose a bug you have not seen. When the environment blocks the run, try one
workaround, then ask them to unblock it, naming the exact command. A CI-only failure runs locally first;
a local pass against a CI failure is itself a finding. Lock in a fast signal: a command that fails in
seconds, every time, with the user's symptom; pin the clock and seed until a flaky bug fails reliably,
and shrink it until removing any input makes it pass.

**Trace to the root cause**, backwards from the symptom: a `file:line` plus why that code produces this
symptom, with a confidence (high: traced end to end; medium: a strong hypothesis with evidence; low
means more evidence, never a fix). Where the error surfaces is not the root cause. Across components,
log each boundary once to see which layer turns good data bad; check what changed (`git log -S
"<token>"`) and compare with a working example of the same pattern. When unsure, write two or three
falsifiable hypotheses, ranked, each with the observation that would kill it. Remove temporary
diagnostics before you finish. If the diagnosis shows nothing is broken, say so in one line and run
`qualitylayer task set type=feature`.

`{plan_doc}` for a bug:

- **Summary**: the bug, its cause and the fix in 2 to 4 one-line bullets, then `**Size:**` and
  `**Trust boundary:**`.
- **What breaks**: a `| | |` table with **When**, **Today**, **Expected** and **Must keep working**
  (named tests or flows, never "the existing tests"), one short sentence each.
- **Why**: the reproduction (the exact command and the telling output lines) and the root cause in
  plain words, with one diagram, left to right, of where the bad value goes.
- **Done means**: the symptom gone as the user meets it, and what must keep working. Steps in a `| Step
  | Action | Before the fix | After the fix |` table: what you do, what shows the bug, what shows it
  gone. A step creates the fixtures it needs. Every point has a step that fails before the fix (a Must
  keep working point says it holds today too).
- **Scope**, **Approach** (the minimal change at the root cause, in two sentences, and what was not
  chosen), then the folds that have something to say.

`agents/{plan_doc}` adds **Root cause in code** (`file:line`, the confidence, the offending code as it
is today, never a `diff`), **Investigation** (each hypothesis and what killed it, plus boundary inputs,
cancellation paths and concurrent callers checked) and **Full reproduction output**. Ask only what is
hard to reverse or changes scope (whether a neighbouring behaviour should change too, what correct
output is when the code cannot tell).

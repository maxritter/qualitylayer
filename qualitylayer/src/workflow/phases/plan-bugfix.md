## A bug's Plan

For a bug, you diagnose directly in this checkout (no research helpers). Everything above applies; these sections replace the feature list.

**Reproduce before theorising.** Run the reproduction and read its full output (warnings and earlier log lines often name the cause). Never diagnose a bug you have not seen; ask for missing conditions if it will not reproduce. On an environment block, try one workaround, then ask the person with the exact command. Run CI failures locally first (a local pass is itself a finding). Lock in a fast, deterministic reproducer (pinned clock/seed, minimal input).

**Trace to the root cause** backwards from the symptom to a `file:line` and why that code produces it (high confidence = traced end to end; medium = strong evidence; low = gather more evidence, never guess a fix). Log boundaries once across layers, check `git log -S "<token>"`, and compare against a working example. Rank 2–3 falsifiable hypotheses with what would kill each; remove temporary diagnostics when done. If nothing is broken, say so in one line and run `qualitylayer task set type=feature`.

`{plan_doc}` for a bug:
- **Summary**: bug, cause and fix in 2 to 4 one-line bullets, plus `**Size:**` and `**Trust boundary:**`.
- **What breaks**: `| | |` table with **When**, **Today**, **Expected**, and **Must keep working** (named tests/flows, never "existing tests").
- **Why**: exact repro command + telling output lines, plain-word root cause, and one left-to-right diagram with a `### <Title>` showing where the bad value goes.
- **Done means**: symptom gone + must-keep-working points, using `| Step | Action | Before the fix | After the fix |` (self-contained fixtures; every bug step fails before the fix).
- **Scope** (`### In scope` / `### Out of scope`), **Approach** (minimal root-cause fix in 2 sentences + rejected option), then non-empty folds.

`agents/{plan_doc}` adds **Root cause in code** (`file:line`, confidence, current code — no `diff`), **Investigation** (hypotheses + boundary/cancellation/concurrency checks), and **Full reproduction output**. Ask only what is hard to reverse or changes scope.

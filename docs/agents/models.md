# Lasting models and their drift guards

Four lasting models describe what the code does. A change is done when its model and its code agree,
in the same commit (or the model's own commit just before it).

| Model | Source | Code it describes | Check |
| --- | --- | --- | --- |
| App Model | `qualitylayer/artifacts/app/app-model/` and its `coverage.json` | the App (`qualitylayer/src/ui`, `qualitylayer/app/frontend`) | every page listed with status, files and demo; built pages map existing files |
| Website model | `qualitylayer/artifacts/site/website-model/` (`sync-manifest.json`, `current/`) | `docs/site` source and the shared App source it renders | the manifest's hashes match the source; `current/` matches its manifest |
| Backend Model (`team` check) | `qualitylayer/artifacts/collaboration-data-model/launch.js` and `index.html` | `docs/site/api` | tables after every migration in `_lib/schema.sql` = `launch.js` tables not marked removed; route handlers = `launch.js` routes; retired routes have no handler |
| Workflow | `qualitylayer/artifacts/app/workflow/` (`model.json`, `coverage.json`, the step pages, `generator/`) | `core/flow.ts`, `core/task/stages.ts`, `core/docs/names.ts`, `src/workflow/schemas`, `src/workflow/phases`; the step pages in `src/ui/steps`, `src/ui/step-page` and the Reader | steps, approvals, files, exits and each step's sections per file (heading, order, file, show, writer) equal the code; the generated files match their frozen inputs and stay under 3 MB |

## Checking

### Whole-view parity

A model page includes every shared component it renders: header, navigation,
sidebar, view controls and overlays. Before presenting a revision, compare that
whole view with the current candidate, including controls already removed or
approved in another session. Reuse current production components where possible;
an illustrative replacement remains proposed until parity is verified.
Include each changed control's opened menu or popover and its selected, disabled
and error states. A closed-header capture cannot establish their parity.

For each changed shared component, identify the dependent model pages and their
production consumers. Update them together. Inspect the relevant states at actual
content widths in both themes, including workflow and standalone-artifact uses.
Before marking built, retain the candidate source revision, model revision, changed
dependency hashes and rendered comparison with the verification record. A later
source or shared-model change invalidates the affected comparison.

Unresolved drift is unfinished work: keep the affected pages proposed and fix
them before handover, installation or publication. A coverage entry, hash check,
approval of another revision or another session's claim is not parity proof.

## Model checks

From `qualitylayer/`: `bun run check:models` prints the drift report for the working copy and exits 1
on a mismatch. `--index` checks what the next commit records, `--only app,team` narrows it,
`--release` also fails on shared App source the website export has not caught up with, `--json`
prints findings. It is local and takes well under a second.

A mismatch is fixed by changing the model or the code until they agree. When design and App differ,
the design wins, unless the design is worse than what is built; then the model follows the App.

## Coverage (App Model and Workflow model)

The App Model and the Workflow model each have a `coverage.json` of the same format (`pages`, one entry per top-level
page). The three step pages (Plan, Implement, Verify) and the Reader's For agents are the Workflow model's: their App source is mapped in
`qualitylayer/artifacts/app/workflow/coverage.json`, so a commit that changes it pairs with those pages. The App Model
keeps the shell and every other screen. `check:models`, the commit guard, `check:overflow` and the demo-URL check read
both files. The App Model draws no step page; its `page-frame.jsx` stands in a link to the Workflow model's page.

Each entry has a status:

- `built`: the App matches; `files` are the components that render the page, `demo` the
  `/app-demo/?…#/…` URL that shows it (or `null`).
- `planned`: the agreed design the App does not match yet; `gap` says what is missing in one line.
  A planned page may name files that do not exist yet. The release notes list planned pages as not built.
- `exploration`: a study sheet or a superseded page; `note` says which page the App follows.

A built page's `demo` is its own: `check:models` fails when two built pages share one URL, when a
`?moment=` is not a demo moment, or when the URL uses the retired shared-step route `#/step/…`
(open a local task's step with `?open=text:<Step>` on `#/task/<id>`). A state the demo
cannot show gets `demo: null` and a note saying why. It warns when the model's moments (`data.jsx`)
and the demo's (`demo/task/moments.ts`) differ.

Map the components that draw the page, never routing or data glue (`App.tsx`, `api.ts`, hooks): a
mapped file makes every edit to it pair with the model. Add the entry with a new page, flip `planned` to `built` in the commit that lands the gap, and
point `files` at the new component when code moves. Delete a page together with its entry.

## The commit guard

`.github/hooks/commit-msg` runs `qualitylayer/scripts/model-guard.ts` on the index. It blocks:

- a staged App file that `coverage.json` maps to a page, unless one of those pages, a model file the
  page loads, or the page's coverage entry is staged too (tests are never mapped);
- a staged `docs/site/api/_lib/schema.sql` change, or an added, removed or renamed route handler,
  without a Backend Model change;
- a staged phase text, schema, `core/flow.ts`, `core/task/stages.ts` or `core/docs/names.ts` without a
  Workflow artifact change; a staged App file that the Workflow `coverage.json` maps to a step page, without that page,
  a model file it loads or its entry;
- a staged `docs/site` source file the website manifest records with another hash (or a new or
  removed one) without the refreshed export (`bun qualitylayer/artifacts/site/website-model/sync-source.mjs`);
- any model check failing on the index for a model the commit touches.

Each block names its fix. Two message lines answer it instead:

- `Model: updated in <commit>`: the model changed first, in that commit; its files count as staged.
- `Model: none (<why>)`: the model stays right (a test-only or internal change, a fix with no
  visible effect). The reason stays in the commit. `Model: unchanged (<why>)` reads the same.

Merges and the first commit are not judged. Shared App source behind the website export is a note,
not a block; refresh the export before a release.

## The Workflow model's data

`model.json` holds the steps, who approves what (`approve`, `approvedBy`), each step's file, agents' file and exit, and per
step the `people` sections (in `NN-step.md`) and `agents` sections (in `agents/NN-step.md`) with writer (`w`: agent, ql,
help, mixed) and where it shows (`s`: lead, fold, detail); `bug` holds a bug's variant of a step. They come from each
page's *Two files* and *Who writes what*; a section the pages do not mention stays as the schemas have it. The check
compares them with the flow, the stage transitions, the file names and the schemas (including each section's `file`).

`proposed` lists every difference between the model and today's schemas: the finding's id, the slice of the
implementation plan that removes it and a note. The check reports each as planned, not failed, and warns about an entry
that no longer differs. Remove an entry in the commit that lands its slice; the list is empty when the build is done.

## The generated files

The pages show the App's own parts and real pictures, generated by `qualitylayer/artifacts/app/workflow/generator/`:
`bun generator/build.ts` (from that folder, with Chrome and the App's UI bundle `src/server/ui/app.css.bundle`) writes
`app-parts*.js`, `review-pics.js`, `verify-data.js`, `verify-pics-*.js` and `implement-cards.js` from the frozen copy in
`generator/inputs/` and records every input and output hash in `generator/manifest.json`. `bun generator/freeze.ts` refreshes
the inputs from the two tasks in `docs/plans/` (ignored by git). `check:models` fails when an input or output differs
from the manifest, an output file is over 2 MB or the outputs together are over 3 MB, and warns when the App source the
parts pack (`MermaidBlock`, `ArtifactPreview`, `TaskCards`) changed since the build; rebuild then.

## Setting the Workflow model up on another machine

The Artifacts library reads per-machine registrations in `.qualitylayer/artifacts/` (ignored by git). The Workflow one is
`.qualitylayer/artifacts/workflow/artifact.json` with `"source": "qualitylayer/artifacts/app/workflow"` and
`"entry": "index.html"`. For a browser preview run `bun artifacts/app/serve.ts` from `qualitylayer/` and open
`http://127.0.0.1:8766/workflow/index.html`; `bun artifacts/app/check/workflow-check.ts` draws every page in both themes.

## Workflow rules that live here, not in a page

- A step page keeps its last complete rendering while an agent writes its file: while the file has a
  marker problem (a marker opened and not yet closed), the page shows what it showed last for that
  step, then the new text as soon as the file is whole (`src/ui/step-page/steady.ts`, Max, 10 Nov
  2026). A file that was never complete renders as it is.

- A contextual request about the Verify document never settles its final approval gate or marks a result
  verified; delivery and approval remain separate facts.
- The walkthrough's optional change-attribution data compares the task's attributed files with the Implement
  cards' Files (`agents/02-implement.md`, matched with the commit-scope path matcher). Without cards it is
  omitted, never reads As planned, and claims no current-source verification. The helper retains the name `riskAtMerge`.
- If the selected checkout does not contain the product or surface the person asked to change, the agent names it, stops
  editing and advancing and asks the person to restart through New task's project picker with the request and answers
  kept; it never retargets the run or moves task state. The current `plan.md` states this checkout boundary;
  `plan-bugfix.md` inherits it.
- The commit hook checks configured scan credential helpers before it builds the staged snapshot, and a commit reports a
  slow checkout inventory and every parent-race retry.
- A Plan's lead budget counts authored prose and tables only; the generated `ql:artifact` fallback description does not
  consume it. An amendment note holds up to 200 characters of plain explanation; generated task IDs and the amendment
  prefix do not count.

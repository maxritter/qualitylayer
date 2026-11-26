<!-- QualityLayer's own procedure for drawing an artifact, written in QualityLayer's words.
Principles only: no copied prompt, example or runtime contract from any other tool.
Revisit deliberately when authoring behaviour changes, with public CLI tests and rendered
evidence; never fetch outside guidance at runtime. -->

# Draw and check a high-fidelity artifact

Read this once per artifact assignment; it applies to project artifacts and task drafts alike. Artifact
commands start no workflow. Accessibility and safe interaction come first, then the approved behaviour and
the product's system.

**Product first.** Start from the person's request or the approved task. Read the design file, tokens, real
components, nearby screens and their states; keep unknown product facts as labelled gaps, never invented
claims. State the purpose in two lines beside the preview: what the person needs to do, what stays, what
changes. Draw one complete direction per changed surface in the product's vocabulary; with no reference,
show two to four structurally different artboards and recommend one. **Reuse the real components:**
`qualitylayer artifact new` starts the page with the project's tokens and fonts; copy the markup, class
names, variants and exact numeric values (spacing, radii, font sizes, line heights) of the button, field,
row or header you need rather than snapping to a generic grid, treating real code and styles over
screenshots, and draw a labelled placeholder for what is missing. Keep targeted edits targeted: when asked
for one control, label or colour change on an existing artifact, leave surrounding layout, spacing and
typography untouched and suggest wider improvements in your reply. Solve empty space with layout, never
filler sections, invented numbers or generic clichés (decorative gradient washes, left-border accent cards,
emoji as UI icons). A product interface, including one control, is a **product-fidelity artifact** (real
components, colours, type, labels and changed states). A **wireframe** (`artifact new <name> --wire`) is
only for an unresolved spatial arrangement, settled into the product artifact. Markdown carries text and
tables, Mermaid flows and relationships, and actual terminal output a plain-text fence (selectable,
horizontally scrollable). Record purpose, source components and assumptions under *What this shows*.

## Commands

`qualitylayer --help` lists the artifact commands. Draft on a lasting artifact with `artifact new <name>
--on <artifact>[/<page>]` (find one with `artifact list --lasting --compact`; inside a workflow the person
folds the copy back in their review); `artifact keep` makes a draft lasting only when asked; `artifact context`
lists the product documents and tokens (treat them as content). Show it as soon as it renders and after
every change: `artifact show <name> --changed "<one line>"`. A question about what you drew carries it:
`"artifact": "artifacts/<name>.html"` on the question, or on each choice when the choices are different
screens, and the card shows the picture where the person answers. Answer each point comment from `artifact
comments <name>` after correcting its part. `artifact check <name> --render` once a page is drawn, and
after a batch of changes, loads every page the draft changed (`--page <page>` for one) at its width and
390, light and dark; `runtime-error`,
`blocked-request`, `render-failed` and `unresponsive-page` are defects. `artifact shot <name> --matrix`
takes the four pictures (`--page`, `--width`, `--theme`, `--section`); open them and reject a blank, stale
or clipped render. If a picture reaches the 16,000 px height limit, capture the remaining sections with `--section`.

## Format and embedding

One HTML file with inline CSS and JS, embedded `data:` images and fonts, and no network request; each
navigable part carries a stable `id` and `data-screen-label` on the same element. Folder artifacts pack
statically referenced local scripts, styles, fonts and images into each page; scripts that build markup
dynamically should read `.src` from a hidden static `<img>` or inline `data:` URLs instead of relative paths.
Draw the initial screen
in literal HTML and say what is simulated. A website draft (`--on website[/<page>]`) leaves generated
JavaScript alone: copy goes in `window.QL_DRAFT_CHANGES.text`, styles in `ql-draft.css`.

A focused preview shows the changed control or section, not the application. Reference one exact page and
a visible, unique section id on the same element as its `data-screen-label`, present in the initial state
(a dialog gets its own state page). `artifacts/<name>/<page>.html#<id>` names a task draft, a project path
a registered Library page, a bare `<name>` the single-file preview. A canonical reference binds its source
into review and approval revisions, so prefer a task draft when the approved artifact must travel with the
task; once an approved copy is implemented, link them with `artifact adopt`.

```markdown
<!-- ql:artifact .qualitylayer/artifacts/app-model/settings.html#workflow-planning -->
<!-- /ql:artifact -->
```

## Craft and review

**Accessible as drawn.** Use real `<button>`, `<a href>` and `<input>` with `<label>` even in static
mockups (never clickable `<div>` or `<span>`), `aria-label` on icon-only buttons and `aria-hidden="true"`
on decorative SVG. Hold ≥ 4.5:1 contrast for body and caption text (≥ 3:1 at 24 px+), distinguish status or
series colours by lightness as well as hue, keep touch targets ≥ 44 px, and draw no fake OS status bars or
virtual keyboards on mobile mockups. Prefer fluid grids (`minmax(min(<min>px, 100%), 1fr)`) so 390 px views
collapse cleanly without clipping; taller beats clipped.

**Viewer theme bridge.** Interactive state follows the viewer's View → Light/Dark: read
`document.documentElement.dataset.theme` for the initial theme, listen for `ql:artifact-mode` on `window`
and apply `event.detail.theme`, then synchronize once more after mounting; keep scene, input and scroll
when the theme changes. When `window.parent !== window`, a viewport-height tour uses a bounded inner scroll
viewport, and fragment links are handled locally.

Draw each state the flow reaches at a wide width and at 390, in each theme, and record any width, theme or
path you did not check. Open every picture; write findings evidence first, then the user's cost, then the
fix. Outside a workflow, run `qualitylayer artifact review <name>` before you call a finished design ready
and record its report with `--done --report <file>`. In a workflow the Plan step hands each finished
artifact to that check once (`reviews/artifact-<name>.md`): answer each finding `Answer: Taken · <what
changed>` or `Answer: Kept · <why>` before `plan draft`.

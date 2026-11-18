## This is a recheck

The **Independent review** ruled on iteration {previous} and the build changed since. Recheck what
failed and the lines the change touched; do not start over. Read iteration {previous} in
`agents/{verify_doc}` first (every part, when it was judged in shares), then the change `{fix}` and
every amendment added since.

- **Run again** each failed or affected step within the Plan's approvals. If a matching service need
  is still open and the recorded evidence still shows the same blocker, record the blocked step as
  `environment:` and cite that evidence. A restored service or changed conditions warrant a bounded
  recheck. When you cannot tell whether the change reaches another step, run that step.
- **Every other pass stands** with its evidence. QualityLayer carries it; you record nothing for it.
- **Review** the change in full and the rest of the diff where it meets it. A bug you reproduce in
  the lines the change touched fails the round. Anything new you find outside what failed and those
  lines is a `[NOTE]` with its test, never a failed round; a reproduced bug among them is marked
  `[NOTE] bug:` so the build session fixes it before the person's review.

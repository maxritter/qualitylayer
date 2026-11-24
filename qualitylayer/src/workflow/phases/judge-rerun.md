## This is a recheck

The **Independent review** ruled on iteration {previous} and the build changed since. Recheck only what failed and the lines `{fix}` touched; do not start over. Read iteration {previous} in `agents/{verify_doc}`, `{fix}`, and any new amendments first.

- **Re-run** each failed or affected step within Plan approvals. If a matching `environment:` blocker or service need is unchanged since the prior round, record `environment:` citing the existing proof without burning another live attempt. A restored service or changed conditions warrant a bounded recheck. If unsure whether `{fix}` affects another step, run it.
- **Prior passes stand:** QualityLayer carries them forward; do not re-record them.
- **Review `{fix}`** and where it meets the rest of the diff. A reproduced bug in lines `{fix}` touched fails the round; anything new outside failed items and `{fix}` is `[NOTE]` (mark a reproduced bug `[NOTE] bug:` so the build session fixes it before the person's review).

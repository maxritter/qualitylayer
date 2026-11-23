---
name: ql-quality
description: "Review code health and run local security scans (secrets, dependencies, workflows, risky code) with QualityLayer's local tools. This does not start a planning/build workflow."
---

QualityLayer is commercial software. These workflow instructions are covered by the QualityLayer licence. Source inspection and contributions do not grant complete product build or standalone distribution rights.

# Code health

The binary: `{{QUALITYLAYER_BIN}}`. Run these commands inside the repository.

1. Run `{{QUALITYLAYER_BIN}} quality status --json`. Installation and updates
   prepare a private Qlty binary and the four security scanners. If setup failed, run
   `{{QUALITYLAYER_BIN}} quality setup --json`; a hook never downloads tools.
2. Check the files changed for this task with
   `{{QUALITYLAYER_BIN}} quality check <paths...> --json`. With no paths, the
   command checks changed and untracked source files. Hooks collect the current
   session's edits and check a bounded batch when the turn ends. Findings reach
   the agent with its next prompt or tool result; the check does not start another turn.
3. Read each finding against its source and consequence. Fix relevant problems
   and run the affected tests. For an intentional pattern or deferred improvement,
   use `{{QUALITYLAYER_BIN}} quality acknowledge <id> --reason "<specific evidence and repair boundary>"`.
   This retains a reviewed reason; it does not repair the code. Changed source,
   duplication counterparts, analyzer configuration or a higher metric require
   review again. `known` means seen before, not reviewed.

An analysis that failed, timed out or had no admitted source is not a clean
check. Inspect its status and reason. Keep repository tests, typechecks, security
checks and required commit/release gates.

## Broader checks

- At a stable join, `quality check --all --duplication --json` checks the
  admitted project scope for duplication. A focused scan compares only its
  selected files; it cannot establish repository-wide duplication coverage.
- `quality metrics <paths...> --json` returns Qlty's function metrics as native
  text with capture metadata. Use `--all` for a deliberate project review.
  Metrics identify hotspots; a high count is not proof of a defect. Avoid adding
  directory rollups to produce a total.
- `quality lint <paths...> --json` runs the project's enabled Qlty plugins.
  Configure the project's chosen linters in `.qlty/qlty.toml`; existing lint
  commands remain valid. Manual lint may need the plugins' installed runtimes.
  Review plugin findings with the project's own linter controls. QualityLayer
  acknowledgments cover built-in structure and duplication findings; plugin
  policies can depend on configuration outside the checked files.
  Automatic feedback runs local structure checks, without plugin bootstrap,
  external model calls or autofixes.

## Security scans

`quality scan [paths... | --since <rev>] --json` scans changed files on this computer with four
pinned tools: Betterleaks (secrets), OSV-Scanner (known-vulnerable and malicious packages, when a
lockfile changed), zizmor (GitHub workflows) and OpenGrep with QualityLayer's own rules (request
input reaching a shell, query, file path or outgoing request in JavaScript, TypeScript and Python).
`--secrets`, `--dependencies`, `--workflows` and `--code` narrow it. Turn-end hooks run the secrets
scan on edited files; Verify's `check all` runs all four on the task's changes.

- A finding is a candidate, not a verdict: read its source, fix a real problem, and say why in one
  line when it is not one. Rotate a real secret; moving it is not enough.
- `not checked` (a missing tool, a timeout, a file the tool could not parse) is never clean; name it.
- Dependency advisories go to osv.dev unless Settings › Security scans uses the local copy
  (`--local`). Never turn on a scanner's live secret validation; it sends the secret out.
- Project allowlists stay the project's: `.betterleaks.toml`/`.gitleaks.toml`, `osv-scanner.toml`,
  `zizmor.yml`.

Checks are advisory by default. `quality check --fail-on-new` explicitly fails
while findings remain unreviewed, including previously seen findings. Never
bulk-acknowledge output merely to satisfy that option.

`quality off` pauses checks for this project; `quality on` resumes them.
Reports and reasons stay local. Use the existing native client hooks and plugins;
another watcher or MCP server is unnecessary.

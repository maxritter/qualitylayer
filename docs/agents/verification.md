# QualityLayer agent reference

## Commands

All in `qualitylayer/`:

- `bun run typecheck` · `bun run lint` (Biome) · `bun run lint:fix`
- `bun run dev:cli -- [--home <dir>] [--repo <scratch-repo>] <args>` — the source CLI
  in an isolated home (default `$TMPDIR/qualitylayer-dev-cli`, reused between runs)
  with a trial signed by a throwaway key only that process trusts: no real home,
  no network, no `licence_required`. Pass a scratch repository as `--repo`.
- `bun run dev:ui` — source-backed App demo on loopback with Vite reload;
  `bun run test:ui` — Playwright checks with semantic interactions, geometry
  and axe, in desktop light while working; `bun run test:ui --all` adds dark
  and a 1024 × 720 window (CI runs `--all`). Nobody uses the App on a
  phone: there are no phone checks. Both Claude Code and Codex
  use these commands. Read `qualitylayer/TESTING.md` for setup and evidence.
  A UI change is checked open: every menu, dropdown, popover, card and
  sub-page it touches, at its real width, in light and dark.
  Check CSS and font changes in the compiled App too: a correct Vite view can
  hide a bundling defect. `tests/scripts/ui-font-css.test.ts` guards the shared
  font cascade; final native checks still use the installed App.
- `bun run test` or `bun run test:smoke` — the finite critical-feature smoke
  gate, each file in its own process (plain `bun test` leaks the test DOM
  between files). Builds a private binary unless `QUALITYLAYER_TEST_BINARY`
  pins and copies an existing candidate into the run folder; `--all` adds broad
  regression coverage. The default binary compiles a bounded private source copy;
  one unstable capture may settle once, starting its second bounded capture
  within five seconds of the first capture starting, before compilation.
  Compiler failures and tests are not retried by capture. Source digests, binary
  hashes, attempt scopes and later source drift are recorded. Tests still read
  live modules and borrow installed dependencies; see `qualitylayer/TESTING.md`.
- `bun run test tests/e2e/x.test.ts` — a directory or single files, whatever their
  time: the slower files that cover what you changed
- When a step page's markup, sections or document grammar changes, include the
  affected `tests/e2e` consumers in that wave or batch's checks. Find them through
  the changed headings, passage anchors, shared page fixtures and helper callers;
  `tests/ui`, core and browser checks alone do not cover these contracts. Keep
  Cockpit starts bounded and run the selected files together once after the batch.
- `bun run test --all` — broad regression coverage on the final commit in CI or
  nightly; use the beta policy below for local release work
- `bun run build` — the development binary in `dist/qualitylayer`;
  `bun run build --all` — the six release targets with checksums
- `bun run release-gate --agent claude-code|codex|pi|opencode` — a real agent carries the
  reference task (`tests/release/reference-task/`) to shipped: the Plan gate
  and the final review are approved through the App API, and the harness
  starts Implement with a natural-language QualityLayer request. `--plan-only`
  stops at the Implement stop. Uses the agent's own login; all QualityLayer
  state goes to a temp `QUALITYLAYER_HOME`. Defaults to Claude Sonnet 5.5 or GPT-6.1 Terra
  for workflow qualification, including isolated helper/reviewer hints; `--model` overrides
  the worker model and `--config` overrides test settings. Costs real agent time.
- `bun run evals [--agent …] [--only discuss,plan]` — phase evals
  (`tests/evals/*.json`) judged on real runs of the flow; before releases, not
  per commit
- `bun scripts/transcript-cost.ts <session id | file | folder> [--json]` or
  `--gate <release-gate logs>` — what a run cost, from the agents' transcripts
  (estimates at list price)
- `bun run eval:activation [--agent claude-code|codex]` — real-client opt-in
  probes using the agent's own login, a temp HOME and a recording stub instead
  of the QualityLayer binary. `QUALITYLAYER_ACTIVATION_CODEX` and
  `QUALITYLAYER_ACTIVATION_CLAUDE` can select native executables when a local
  launcher depends on the real HOME.
- Coordinate with the release owner before test/build work during a release gate.
  `bun run build` replaces `dist/qualitylayer`; the ordinary test wrapper keeps
  its binary, generated UI and development key private, but selected release or
  protection fixtures can still explicitly build secondary outputs.
- Git hooks (`core.hooksPath=.github/hooks`, shared by every worktree) gate
  commits and pushes: `pre-commit` runs typecheck, lint, the Cockpit checks,
  cargo fmt and clippy for the App, shellcheck, actionlint and Trivy on what is
  staged; `pre-push` runs `.github/scripts/check_qualitylayer_encrypted.sh` over the
  pushed commits. Fix what they report; never bypass them with `--no-verify`


## Beta verification policy

Start completed subsystems' checks while independent work continues. A UI-only
sidebar change can join after workflow, memory, backend and permission runs;
then verify the changed UI and combined App. The release procedure owns evidence
reuse by affected paths and final signed-artifact verification.

For a lifecycle change, run one complete normal workflow through the public App
or CLI path before expanding edge-case fixtures. Retain the real persisted gates
from preceding steps. A final-approval fixture with no stored Plan gate does not
qualify the Plan-to-Review handoff. Lower-level tests supplement that full run.

For every stable/beta release or main/dev staging push, read
[the canonical release procedure](release.md). It owns source-first quality,
bounded test/coverage reuse, resource handoffs, approved-main README preservation,
same-byte promotion and the learning closeout. The
[local-code-quality skill](../../.agents/skills/local-code-quality/SKILL.md)
owns exact Sonar/Qlty/preflight commands. These maintainer requirements remain
outside the shipped customer workflow.

### Live feedback and sharing

The feedback delivery fixtures mock GitHub and mail. Their passing results do
not establish that the production token can create issues in the current public
repository or that the owner receives private support. Before accepting a release
that changes reporting or its destination, use the actual candidate App and live
service, with Max's authorization for the disposable reports:

- Create one bug and one improvement, each with a screenshot and environment
  information. Independently read both GitHub issues and rendered images; compare
  their content, labels and App receipts with what the person confirmed.
- Send private support with a screenshot and diagnostics. Independently verify
  the private issue and the message received by the support inbox, including its
  image and environment information. Public issue creation does not prove this.
- Retain the binary hash, issue references, checks and delivery evidence privately.
  Close the disposable reports with a substantive test explanation, revoke test
  links and release test activations. Archive test notifications when authorized;
  keep real customer reports tracked until their fixes are available.

For public workflow and included-artifact sharing, the opt-in browser journey is
`bun tests/release/public-share-browser.ts --live --artifacts --binary <absolute
published-CLI-path> --sha <sha256> --keys <private-key-file> --site
https://qualitylayer.dev --out <private-evidence-directory>` from `qualitylayer/`.
It uses a disposable home, creates a synthetic link, reads workflow documents and
two artboards, checks both themes and phone/desktop widths, sends separate
workflow and artifact feedback, verifies the owner's CLI replies in the guest
page, revokes the link and releases the activation. Inspect the pictures too:
document-wide overflow checks can pass while a selector is clipped inside a
container. A local compiled-site journey complements this live check when the
website source changes; record which version each result actually tested.

## Subscription commerce

- From `docs/site`, `npm run test:checkout -- <origin> [private-output-directory]`
  opens Solo and Team, monthly and yearly, and waits for Stripe's card-number,
  expiry and security-code fields. It never enters payment details or submits a
  purchase. Use a production-mode source server for a local check; development
  environment overrides may point to sandbox products. The Source UI browser
  gate includes this check before a release can pass.
- `npm run verify:commerce` uses `POLAR_ACCESS_TOKEN` for a read-only live catalog
  audit: prices, QL licence benefits, PILOTTHANKS15's 15 percent / 12 months /
  exact product scope, and archived Pilot Shell products. Missing credentials
  or incomplete provider inventories fail the audit.
- Checkout readiness and catalog checks do not prove fulfilment. Before a
  commerce change ships, complete a Polar sandbox purchase, verify the licence
  grant and delivery, activate in an isolated QualityLayer home, and release
  that test activation. Keep existing customer subscriptions untouched.

## Test cost

- The push tier is budgeted: `qualitylayer/scripts/test-tiers.ts` and
  `tests/scripts/test-budget.test.ts` hold the smoke tier to 6 worker-minutes.
  The full suite has no minutes total (Max, 9 November 2026): its limit is each
  CI shard's 15 minutes, and a slower suite is split into more shards or made
  cheaper. The runner names a file over twenty seconds that `SLOW` doesn't list.
  Raising a budget needs the person's approval.
- Test at the cheapest level that proves the behaviour (TESTING.md): unit and
  component tests first, an in-process server for the API, and the built binary, a
  browser or the native App only for what only they show, one flow per journey.
- No fixed sleeps to wait for something; share a fixture per file; tests for
  retired behaviour leave with the code.
- While working run `bun run test` plus focused slower files for changed risks.
  Schedule broad regression according to the beta policy above.


Before a real Copilot workflow in an isolated home, supply its supported operator authentication
and check native `auth.getStatus` and `models.list` without creating a model session. A copied
`config.json` does not establish login. The extra-native profile clears general GitHub token
variables and retains only explicit `COPILOT_GITHUB_TOKEN`. Reuse an existing account only after
identity and token support are verified; never print tokens, embed them in arguments or source,
copy personal histories, or expand permissions to make a fixture pass. Normal private credential
reconciliation and cleanup still apply. Keep login-only setup failures distinct from provider turns
and product permission failures.

## Workflow benches run on request

- A bench runs only when Max asks for one (18 October 2026), whatever the change: a
  plan, a build, a workflow or gate change and a release go ahead without one.
  Agree the finite run scope before spending provider time or tokens. `bun run
  bench` (skill `ql-bench`, design `docs/designs/workflow-bench.md`) runs
  Claude Code **and** Codex; take the baseline on the same cells.
- Quality first: keep a measured change only when acceptance and test
  strength are not worse on any cell and agent; then time, cost and fresh
  tokens decide. A verdict with `?` is inconclusive; extra runs need an agreed scope.
- Put the compare's headline in the commit body and in
  `docs/designs/workflow-bench-log.md`. Compare QualityLayer with its own
  earlier version only; the plain agents calibrate the acceptance checks.


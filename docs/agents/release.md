# QualityLayer releases

Start here for a stable/beta release or a main/dev push that stages a candidate.
This is the canonical private procedure; executable authority remains
[Release](../../.github/workflows/release.yml), its
[candidate graph](../../.github/workflows/qualitylayer-candidate.yml) and
`qualitylayer/scripts/release-candidate.ts`. A staged candidate is not published.
Use existing authorization for Git writes, installation and publication; this
procedure grants none. Pilot Shell retains its separate 11.x procedure and is
never installed on this Mac.

## Prepare the join

1. Read the published tag/range, dirty paths, peer claims and private feedback
   inbox/backlog. Keep one release owner, one failure inventory and named source,
   quality, browser and publication owners. Handoffs name exact files/pre/post
   hashes, source/runtime identity, completed/pending commands and the next owner.
   Include ignored presenter/model files; verify local state instead of assuming
   a peer's “committed” message means the handoff is present.
   For a patch, name the complete requested scope and finite acceptance cases
   before qualification: formats, views, agents and the reported failure states.
   When focused checks and requested native QA pass, take the next release action.
   An exploratory hypothesis stays optional until evidence establishes a blocker.
2. Use [verification.md](verification.md) for commands/tiers. With approved UI
   changes, migrate unit/component **and browser** oracles in the same batch,
   preserving semantic/geometry checks for the new contract and retiring removed
   behavior's assertions. Make each fixture's App or Terminal mode explicit and
   cover its headless entry path; a developer's attached client can supply defaults
   and native process records absent in CI. Include affected document/e2e consumers.
   Follow shared Reader and kit changes into the Site's DOM consumers and runtime
   verifier fixtures too; App-only tests cannot qualify those callers. Run changed
   consumer tests through their own project's typecheck as well as its test runner.
   Browser fixtures use the production React build and the isolated browser for
   both the test page and server-side captures. Wait for the actual async result
   being asserted; a mounted container does not establish that its query or
   passive effect has completed. Keep the original cases and resource limits.
   For shared headers, include direct and folded actions in every affected caller.
   Measure computed control and text bounds after fonts, identity queries and
   sidebar transitions settle; a minimum height or first-paint screenshot does
   not prove the final layout. Confirm the exact failed controls at their failing
   widths before another broad control sweep or normal commit attempt.
   Exercise new cross-surface paths through their actual UI, API and CLI entry
   points before signed staging. A store-level test cannot establish that the
   command reading those records returns them; final signed QA verifies the
   deployed bytes after that path already works in isolated checks.
   Include qualification drivers in this consumer review. Inventory the selected
   driver's transitive fixtures and typecheck it with the admitted source's ambient
   declarations. Observe the current production-verified licence tier and real
   fingerprint before selecting a version-specific signed-QA adapter. Before a paid
   native run, check current controls, explicit model forwarding, auth schema and native
   permission protocol with cheap setup checks. Use the normal interactive route
   when print mode cannot ask for permission; an old driver's force flag is not
   evidence of the person's current policy.
   Pin both declared native executables for automatic cross-family review,
   including a single-agent `--binary` gate. Resolve and inspect their native
   files first: a terminal app's shell/Python wrapper is not the native profile.
   Cover every selected entry path. CLI-mode `--app-approves` requires a separately
   launched browser observer; it does not start one. Use the integrated App-entry
   driver for its current completed-Review handoff proof. A local
   “approved” flag is no receipt: verify the real owner gate and resulting task
   state, retaining transport errors separately from delivered outcomes. Match
   stage-specific API projections: Shipped omits Review-only display fields;
   the persisted final gate retains the approved disclosure identity.
   Use one bounded resource monitor. A diagnostic process-scan failure must not
   bypass owned-process cleanup and native-auth reconciliation. Preserve private
   credentials until reconciliation or reviewed same-identity CAS recovery passes;
   retain the interrupted run as incomplete, with its original failure.
3. For a patch, finish functional acceptance and freeze the runtime source before
   full qualification; larger changes may use an earlier cohesive join for feedback.
   Collect meaningful source-bound coverage and run Sonar plus full
   structure/duplication Qlty through
   [local-code-quality](../../.agents/skills/local-code-quality/SKILL.md).
   Qualify that complete candidate before refreshing media. A confirmed change or
   red result reopens only the affected work and invalidated evidence; passing
   compatible tests and native journeys keep their original receipts.
   When a module changes, refresh its useful existing coverage consumers beside
   the new regression tests; a focused new test can leave its unchanged paths
   unmeasured after the old whole-file witness expires.
   Each false positive needs its own source/spec proof and native disposition;
   another hit of that rule remains unreviewed. Retain valid complexity as debt.

Claim the Mac's one heavy-job slot when the command is ready: name its owner,
command, source, budget and active process/receipt. Check its exit and output,
then release the slot promptly, even while its owner writes the report.
Read-only preparation does not reserve compute; it can continue independently.
Give a delegated cohort its executable command, `QUALITYLAYER_TEST_WORKERS=1`,
monitor and finite deadline. Confirm those values in its actual run receipt;
macOS `ulimit -v` does not enforce the memory budget. Separate monitor and inner
log paths, and write diagnostic evidence to an explicit retained file: the test
wrapper discards successful test output. Release compute before report writing.
Bun, browser, Rust, docs builds and scans share this slot. Monitor the 4 GiB job
budget; use supported `sonar.javascript.node.maxspace=2048` (MiB) for the JavaScript
scanner. Start it in a fresh process after coverage merging, so collector data does
not remain in the monitored process tree. Inspect emitted properties first: an older controller may still emit 4096;
the quality owner resolves that mismatch before a new scan, outside an active run.

## Qualify and stage

- Start QA for completed subsystems while independent feature work continues.
  Workflow, backend, memory and permission runs can proceed while a UI-only
  sidebar change is being implemented. Use an available working build and record
  what it tested; a clean checkout, final commit or whole-candidate freeze is not
  a prerequisite. Keep a running test's executable stable. After integration,
  review the actual delta and run its affected checks plus a combined App smoke.
  Rebuild and repeat a workflow only when that delta affects the workflow or its
  test setup. Pin the final source and signed artifact identities for staging,
  installation and publication.
- Run the finite smoke gate plus focused changed-risk tests; target 5–10 minutes
  per local batch. Stable and beta use this bounded policy. Exhaustive regression
  and workflow benches run only when Max asks. Keep startup, auth, memory,
  Team/data, upgrade, signing and installed-App checks and normal hooks intact.
- When a full regression was requested, collect the completed results of every
  job before choosing the repair join. Read failures recorded before cancellation
  too. Keep one failure inventory and give each independent repair an owner and
  bounded check. After affected checks pass, join the repairs and run the selected
  final qualification against that commit; open another repair only for a concrete
  failure. Keep optional polish and new investigations outside the release path.
- Reuse successful tests when their relevant implementation, contracts and test
  setup remain compatible. A different commit or unrelated UI edit alone does
  not invalidate a workflow run. Record the tested build honestly and explain
  the affected paths; do not relabel it as a later build. Coverage and analyzer
  imports retain their tool-required file hashes. Measure changed source and
  merge eligible receipts. Preserve failed jobs, old builds and their identities;
  merging does not convert a failed attempt to a pass. Unmeasured stays unmeasured.
  Choose rechecks from the changed runtime and contracts. A fixture-only repair
  gets its targeted check; it does not invalidate a passing production-source
  analysis when that source and its analysis configuration are unchanged. Retain
  the original consumer versions and record compatibility rather than rebinding
  old receipts. Scope native Windows compatibility checks to installer, uninstaller
  and shell-probe changes; reuse compatible passing evidence for unrelated work.
  For a legacy PowerShell fixture failure, run the fixed-scope Windows Boolean
  diagnostic before another candidate cycle. Repair the fixture and retain the
  existing product evidence instead of automatically repeating full workflows.
  Product failures and missing signing or installed-App proof still block release.
  Inspect every collection job's exit and eligibility. The coverage collector
  can successfully merge its passing subset while a test file failed; report
  that failure separately and refresh its affected consumer before qualification.
  After a fixture or internal-test correction passes its affected checks and
  supported hook scope, resume the next incomplete publication step.
  Read the contract before treating a fixture constant as a product guarantee.
  A measurement repair preserves the actual budgets and lifecycle boundaries,
  explains changed sensitivity, and retains the original measurements.
  Use performance limits tied to measured baselines, the relevant lifecycle and
  user impact. A short-window outlier gets a bounded diagnosis of whether a real
  regression exists, rather than another release round by default.
- Pass `bun run check:models --release`, current local dependency/supply-chain and
  source UI/browser checks, and `quality-release-check` before staging.
  For changed site/docs, build and serve the combined production output before
  staging. Keep the Docusaurus broken-link guard and verify merged static assets
  in desktop/phone pages; separate dev servers or model exports do not establish
  that the published output works.
  Read the current workflow's selected test filters before declaring a blocker.
  Optional stress/profiling results remain follow-ups unless they establish a
  confirmed blocking defect; keep failed observations and required gates intact.
  Sonar must be green and full Qlty have zero unreviewed findings on the same
  frozen capture. Exact-SHA required CI must also pass before promotion. Keep the
  pinned Sonar new-code reference through qualification;
  a scan version does not advance it. Capture changed screens after this join;
  backend checks and unrelated commits do not require another screenshot cycle.
- Check release media with `cd docs/site && npm run media:check`. When UI, demo or
  capture inputs changed, run `npm run media:refresh` on committed producer inputs:
  it batches affected existing scenes, refreshes canonical website/README/docs
  copies and replays the complete demo. Review the actual pages in both themes at
  desktop/phone widths, then commit the assets and evidence together. Keep the
  approved frame and crop; Max's 4 November 2026 standing request covers these routine
  release refreshes. New core scenes or reframing follow `public-copy.md` approval.
  The stage workflow repeats the fast freshness/integrity check. It compares each
  capture's inputs, not whole-candidate SHA equality; a version-only bump reuses
  compatible images with their original provenance. Demo checks must come from the
  complete privately built source, not a partial or development-server replay.
  Before publication, account for every changed capability across the README,
  website, docs, screenshots and demo. Use Anti-slop, Deslop and Impeccable for
  the complete affected copy and rendered surfaces. Refresh outdated wording,
  links and existing captures, regenerate their model exports, and inspect the
  actual desktop/phone consumers in both themes. Changed walkthrough captures
  also need `record-showcase.mjs` and the focused `showcase.test.ts` to update
  and verify their fingerprints. Then replay the homepage walkthrough, its
  enlarged view and the README animation; verify
  their highlights, cursor positions, live asset bytes and complete content.
  Record updated surfaces and source-compatible reuse. Stale, missing or
  unverified public material remains unfinished release work.

Keep one qualified SHA through publication. If main moves, follow that SHA's
checks: rerunning an older main-ref run can cancel the current run. Prepare
downloads, installed checks and promotion inputs while CI runs. Once the whole
candidate passes, install, read back and dispatch promotion next; five minutes
is the coordination target. Use the cloud wait for optional diagnostics rather
than placing them before this join. Record actual failures and waits. Known bugs
and incomplete checks remain blockers.

Base a release ETA on the measured remaining critical path: local hooks, media,
required CI, platform packaging, signed installation and promotion. Report which
phase is active and what blocks it. Separate execution time from coordination
and provider waits; update the estimate when a concrete failure changes that path.
Watch the exact candidate's pending environments and complete authorized staging
reviews promptly, preserving their audit records and publication gates.
For a diagnostic-only commit targeting a known red check, collect that check's
result before approving another private packaging wave.

Before dispatching a manual regression with the same check names, verify that
Release's **Reuse CI results** job has completed successfully. Ordinary CI's
success alone is insufficient: that consumer selects the latest check by name,
so a newer pending run can hide the passing result and trigger redundant fallback
tests. Start the requested regression after that acknowledgment, while packaging
continues on the same source.

## Preserve the approved main README

Before **each main push**, compare the intended commit's complete README bytes
with the approved main version, rather than checking only the working copy.
Current copy: the 6 November Website/README revision in `6e8e2e05a`, explicitly
approved by Max: “Both website and readme are approved, update them on dev and
also their artifacts and clean up your dummy ones, then wrap up.” The native
user record is `68309a1a-8e40-4203-8318-54c1e30ceffa`, at22:06UTC. The two
in-place Workflow wording corrections in `2154a7b0d` follow the approved
finished-Review contract. The13.0media refresh changes only the existing
animation URLs, with both hosted loops verified against their local hashes.
The approved layout and skills table remain. This full-file digest binds the copy.
README SHA256
`b5e213f653e918de80ca005f9f1f640e1ef8c224da450d8eef1c72410da4f08d`.
Earlier approved README SHA256s, newest first:
13.0first candidate with the same approved copy and first refreshed animation URLs
`009cca24f3c8fdf2b83bbcb5436572dedf9f457ad8bb50b7a103cf61db942196`;
12.10 concise copy audit and approved walkthrough revision
`8d29f2a9d8246b7d7e505b43052a2a8e31ce8d5735eb32c3ba2cfb45deda69ab`;
12.10 concise copy before the approved website/README walkthrough revision
`2102a1b7ffb17e9f5469244d4c06c1e1de31c772f86dbfd69fade567374db44e`;
12.9 feature follow-ups
`53af719a46fe79946c9ed34f18004795f952b52ab6be37d24912d7ccc269a7f7`;
12.8 Memory and team follow-up
`10bf459a80d4a03535586732713a57fd2cd99dc18571f284c64730e5ba3221ac`;
12.7 workflow-requirements and personal-memory revision, approved by Max's direct
30 October reply, "Approve the 12.7 copy"
`8686efa24b9468daf899912f89721a2ca1435c9adeb08081fab131d4b70b8eb0`;
30 October Blog/author-image/SEO revision
`654f7676f495a52d83a693439b5b32151b1574342b0e8e4532d7279bc81326fa`;
29 October verification section
`99708d15cbe85db29ce1e0ec5678024310871bd87a80d1a00fb38a7fc8a17fe1` (preparation
hash `898c48e5ce31e172d5d7e769b55645bdd895361e676da46148a3756a35efb6e4`);
12.5 `051057f096d41b602cabfba8a5d0f4f64ccac54d61eda280cf0aee07bb466d02`
(published from 539af4867); older copy commit `c9cc341c64b4b099e27c9ae69f26bb02b4186163`,
SHA256 `27f6a463136060f40e785315063a166e4b7d7be3655eac13c657cf999d232dba`.
Inspect intended bytes with `git cat-file --filters <commit>:README.md`.

Preserve these bytes while integrating older dev work. A difference requires
restoring the approved README or Max explicitly approving that exact replacement
copy/design; update this reference only after that approval. A merge, release
request or newer timestamp does not authorize replacement; an overnight release
while Max is away does ([Public writing](public-copy.md), step 5). Inspect the actual
remote before the authorized push; use [operations.md](operations.md) for normal
hooks and shared/private-index handling.

## Stage, install and promote

1. Align the package version with an asset-free GitHub draft for an unpublished
   version. Read current workflow inputs/version selection before dispatch.
   Review notes through Deslop and Anti-slop copywriting: about ten meaningful
   user-facing items, most important first. Use the same Markdown groups in this
   order for every release: `## New`, `## Fixed`, `## Upgrading`. Omit an empty
   group. Put setup, compatibility and update instructions under Upgrading; do
   not publish a flat list or alternate headings such as Good to know. Keep any
   short introduction above the groups. The App, docs and update endpoint read
   these headings from the GitHub body, so format them at that source instead
   of adding separate copies or guessing categories in a renderer.
   GitHub Releases owns editorial notes;
   preserve the candidate marker. Changed notes before promotion need restaging.
2. Budget the outer deadline for the measured complete normal-hook chain,
   including serial Cockpit checks, post-commit work and cleanup. Keep an outer
   timeout in the coordination record alongside the checks' actual outcomes.
   Commit with normal hooks/private index and push the authorized `main` revision
   for stable or `dev` revision for beta; both stage privately. Verify remote SHA, Release run/attempt,
   finite critical-feature CI and source browser results. Read first failures
   before attributing them to infrastructure or creating another attempt.
   For a repeated infrastructure failure, inspect the first actual logs and the
   provider's known-image incidents before retrying unchanged. The Intel-only
   Apple ticket transport workaround in the candidate workflow preserves all
   notarization and validation checks; it belongs on the ephemeral runner only.
3. Download the successful attempt's manifest, catalog and assets into separate
   empty folders. Put catalog `SHA256SUMS` and signature beside assets; a download
   into a populated folder can omit them. Verify identities/hashes/signatures
   with `release-candidate.ts` before executing artifacts.
   Budget transfers from artifact size and observed throughput. After a transfer
   cutoff, preserve and resume the same immutable archive where supported, then
   verify its full GitHub digest before extraction.
   Download-only prefetch may overlap native qualification: bind archives to the
   exact run, attempt, source, immutable artifact IDs and GitHub digests. Admit
   them for execution only after whole-run success, frozen-manifest matching
   and production catalog verification. This overlaps transfer time without
   changing qualification or publication authority.
4. Install the exact candidate where authorized, preserving live sessions;
   otherwise use a temporary HOME/App folder. Record actual App/CLI/engine hashes,
   source commit/tree, version, launch, memory and required native journey results.
   Development builds/keys do not stand in for signed-release proof/credentials.
   Diagnose a CUA client failure separately from service health; use an authorized
   working observer. Give the delegated identity review a finite deadline and record
   its actual App/process/nonce observation before slow image emission, retaining
   the same evidence references. Use that proof for Root's final publication review.
5. Validate `release-candidate.ts promote` locally with the exact run-attempt JSON
   and artifact inventory. Dispatch `operation=promote` on the reviewed publication producer with
   version, run id/attempt, candidate_source_sha and actual installed_receipt,
   using structured inputs. Keep environment approval, payload, signing,
   notarization, migration and publication gates. Promotion reuses verified bytes;
   changed application/build inputs or signed artifacts require a new stage.
6. After a stable publication, dispatch `old-client-update.yml`: earlier releases
   (12.x and the previous 13.x) must update to the new one on Linux, macOS and
   Windows. The new release takes GitHub's "latest" from the v12.99.0 bridge, so
   12.x clients then need `update --version`; a failing old client blocks the
   handover until it has a path (a bridge release on an old-accepted tag).

For a test-fixture or publication-orchestration repair, preserve the qualified
candidate's source, run, artifact digests and installed receipt. A reviewed recovery
producer may differ only in explicitly named non-runtime files. The early
promotion source guard requires ancestry, exact paths and regular files; source
checks, release/tag targets and deployment inputs keep the qualified SHA, while
GitHub provenance and branch-recency checks keep the actual producer. Qualify the
corrected consumer against the original payload and restore its deployment inputs.
Record the qualified source and actual producer with the provider's supported provenance schema;
keep the production approval and public readback. Retire one-time recovery code
after publication. This repairs the failing step without rebuilding unchanged Apps.

Promotion requires the whole candidate run attempt to succeed. After an
infrastructure CI failure, qualify the new attempt and rerun the whole Release
graph once CI is green; rerunning failed Release jobs alone can create an attempt
without its own built artifacts. Preserve every attempt. Read current jobs rather
than assuming old order/counts. Keep previous-release upgrade fixtures on a
published baseline, not a disappearing draft. An App-demo dependency also needs
   the site's independent dependency/dedupe closure and build.

For beta, use an unpublished `-beta.N` version and verify current prerelease/feed
rules: Stable latest/downloads stay stable while Beta/release list names the beta.
Stable publication supersedes its earlier beta releases; tags remain.

## Read back and learn

Verify public version, expected assets, checksums/signatures, updater feeds and
installed version against qualified bytes. Verify website/exact-version links
against the deployment actually produced. Website-only publication uses
[deploy-website](../../.agents/skills/deploy-website/SKILL.md); App promotion does
not publish later site edits. Close only feedback whose verified fixes shipped,
with its required response/posting authorization. State unverified behavior.

After the stable tag and public readback, carry released main into dev through
authorized normal integration, preserving unrelated work and the approved README.
Verify dev's resulting README and release ancestry to prevent stale replay.

Every release ends with a short private closeout:

- Actual outcome/source/artifacts; stage timings and first failures compared with
  the previous run, separating execution from coordination wait.
- Useful findings versus issue-specific source/spec-proven false positives,
  remaining debt and checks that changed decisions. Link retained raw evidence.
- A few demonstrated procedure improvements, or an explicit no-change reason.
  Edit this canonical procedure in place and delete obsolete guidance rather than
  accumulating a rule for each symptom.
- Preserve the latest qualified evidence before deleting release folders: full
  raw Qlty, reviewed decisions/baseline, source proof and run receipt, plus the
  imported LCOV and its test/harness witnesses. Keep this minimal package in the
  quality stack's durable reports store, outside disposable release payloads.
  Verify its digests and reload it through the supported comparison/preflight
  after any relocation. Replace it only once the next package qualifies; a saved
  percentage or native acknowledgment IDs cannot recover deleted review/coverage
  witnesses.
- Clean up after the closeout is written. Delete this and earlier releases'
  regenerable payloads: `qualitylayer/dist/{test-runs,ui-test-results,
  app-updater-test,qualification,e2e,release}`, `$TMPDIR` gate and
  `ql<version>-*` trees, downloaded candidate assets, and copied binaries,
  installers, `node_modules` or `target` folders in
  `~/QualityLayer-feedback/<version>-*`. Then remove those finished release
  folders, keeping the inbox, backlog, `archives/` and the closeout itself.
  Skip a path another live session has open or claims; ask its owner. Record a
  lasting approval, such as README copy, in this file, never only in a folder
  this step deletes. Report the space freed in the closeout.
- Search project lessons, read relevant hits and check against current source and
  protocol. Confirm valid lessons with `memory_keep`; correct one with
  `memory_save` and `replaces` naming its old id. CLI fallback: `qualitylayer memory
  search`, `read`, `confirm`, `store --replaces`. Keep one reusable decision, its
  reason and relevant files per lesson. Record checked/updated ids, or the
  supported reason no lesson change is needed.

This is procedural learning from observed releases. Keep raw reports, secrets,
customer content and transient run data in private evidence, outside rules and
lessons. Model training, background services and gate weakening are outside this
loop.

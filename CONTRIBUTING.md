# Contributing to QualityLayer

QualityLayer is paid commercial source-available software. You can inspect its public nonlicensing application and workflow source, report problems and propose improvements to QualityLayer itself. The licence permits contribution forks, copies, edits, focused checks, patches and pull requests without a subscription. It does not grant reuse in another product or standalone distribution.

## Prepare a contribution

1. Read the applicable licence and this agreement. Fork the designated public source repository once it is available; keep its paths and notices.
2. Change the public component involved. Use synthetic fixtures and its documented focused checks. Do not add credentials, private customer data, private dependencies or a complete-product replacement for a missing private component.
3. Submit a patch or pull request explaining the problem, behavior change and checks you ran. Identify third-party material and its licence. State when you act for an employer or other rights holder.
4. Explicitly accept the submission agreement below for your identified contribution. If you cannot grant the rights, mark the material **For discussion only; not submitted for incorporation**.

The public checkout intentionally lacks private licensing/trial enforcement, backend, internal CI/CD, operations and complete-build/protection/signing tooling. Focused public checks do not build or start the complete App or CLI. Only Max Ritter produces complete official builds using private inputs, directly or through automation he controls. There is no contributor key, proprietary replacement package, permissive complete-product shim or supported self-build route. Max reviews and integrates accepted changes and runs full-product verification under his control. A passing focused check is not complete-product verification.

From the projected `qualitylayer/` directory, run `bun scripts/public/check-workflow.ts` (or `bun run check:workflow-assets`). This verifies the isolated public workflow component. Its canonical generator is `bun scripts/public/workflow-assets.ts --version <exact-version> --out <file>`. These are focused workflow checks, not full-product tests or final whole-projection qualification. Source publication is qualified separately; this proposal does not claim a public repository already exists.

## Contribution Submission Agreement

You accept this agreement only when you intentionally submit identified material for incorporation into QualityLayer and explicitly state your acceptance. General discussion or a bug report is not acceptance for unrelated material.

**Ownership.** You keep ownership of your original contribution. No transfer of copyright is required.

**Copyright grant.** You grant Maximilian Ritter a worldwide, nonexclusive, perpetual, irrevocable, royalty-free licence to reproduce, modify, adapt, combine, publicly make available, distribute, sublicense and commercially license your contribution as part of QualityLayer and its documentation, official releases and associated services, under the commercial terms he selects. This includes incorporation into paid releases. It does not permit using your name to imply endorsement.

**Patent grant.** You grant Maximilian Ritter and recipients of QualityLayer a worldwide, nonexclusive, perpetual, irrevocable, royalty-free patent licence under claims you control necessarily infringed by your contribution alone or by its combination with the QualityLayer version to which you submit it, to make, have made, use, offer, sell, import and distribute that contribution in QualityLayer. The grant does not cover unrelated combinations or products.

**Rights and authority.** You confirm that you created the contribution or have sufficient rights and authority to submit it and grant these permissions. If an employer or another organization owns rights, obtain its authorization and identify it in the submission. Do not submit confidential information, secrets or material whose terms conflict with these grants. Identify copied or adapted third-party material and preserve its notices and licence.

**Acceptance and support.** Submission promises no acceptance, payment or delivery in a particular release. You provide contributions without a separate promise of support or fitness, subject to mandatory law and any separate agreement. Statutory rights and previously agreed contractual terms remain unaffected.

Include this acceptance statement in the pull request or patch:

> I submit the identified contribution for incorporation into QualityLayer and accept the Contribution Submission Agreement included with this submission. I have the rights and organizational authority needed to grant those permissions. Any third-party material and its licence are identified in the submission.

An authorship sign-off alone does not replace this agreement. Acceptance grants contribution rights; it grants no private build access or publication authority.

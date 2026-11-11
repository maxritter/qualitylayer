---
title: "Claude text watermarks: what a code review still needs to prove"
description: "Understand the limits of Claude text watermarking and keep authorship signals separate from tests, behavior and verification evidence."
slug: claude-text-watermarks-code-review
date: 2026-09-30
authors: [max-ritter]
tags: ["guide","review"]
image: https://qualitylayer.dev/og.png
---

A signal that text involved an AI model cannot tell you whether the accompanying software behaves correctly. Code review still needs evidence about the change itself.

<!-- truncate -->

Anthropic announced text watermarking based on SynthID-Text in August 2026. Its explanation describes a statistical pattern in generation choices, rather than hidden characters inserted into a document. It also describes limitations on short samples and constrained text such as code. [Anthropic's watermarking explanation](https://www.anthropic.com/news/claude-text-watermark).

## Separate the questions

A reviewer may need to answer several different questions:

| Question | Evidence to look for |
| --- | --- |
| Does this solve the request? | The agreed behavior and a running example |
| Did it preserve compatibility? | Tests of the existing contract |
| Are the important claims true? | Code references and reproducible checks |
| What is known about how the text was produced? | The relevant provenance information and its limits |

Treating one answer as a substitute for the others weakens the review.

For example, a human-authored retry implementation can still send duplicate requests. An AI-assisted implementation can satisfy the intended contract. The source of the text does not settle the behavior.

## Review a concrete failure

Suppose a job runner must retry a temporary failure without performing a payment twice. The review should identify the retry boundary, the idempotency mechanism and the evidence that a repeated attempt remains safe.

A comment saying “safe to retry” is a claim. A test and an observed repeated attempt can support that claim. The distinction holds regardless of whether the comment carries a detectable generation signal.

Ask the builder to point to the check. If it cannot, the reviewer has found a gap worth investigating.

## Keep a useful record

Save the request, decisions, changes and verification output together. When a result is questioned later, the team should be able to reconstruct why it was accepted.

That record should distinguish a test that passed from a behavior that was tried manually. It should also state what could not be checked. A confident summary that hides those distinctions makes later maintenance harder.

QualityLayer's [Verify](/docs/steps/verify) view groups review rounds and evidence. The [Review](/docs/steps/verify#items) stage puts the change and its manual checks beside the result, so you can inspect them together.

## Avoid overreading a detector

Anthropic's own explanation does not present watermark detection as a test of software quality. It describes a probabilistic signal with sample limitations. Keep any use of that signal within what the provider documents.

The practical engineering decision remains observable: does the running change meet the requirements, and can another person follow the evidence?

Related: [the diagnosis phase](/docs/steps/plan#a-bug) and [building in working slices](/docs/steps/implement).

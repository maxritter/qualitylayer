---
title: "Claude Code Multi-Agent Orchestration: The Cost Math"
description: "When Claude Code multi-agent orchestration saves money and when it adds a 60% markup for nothing. The coordination cost math, measured."
slug: multi-agent-orchestration-cost
date: 2026-07-25
authors:
  - max-ritter
tags:
  - guide
  - development
---

When Claude Code multi-agent orchestration saves money and when it adds a 60% markup for nothing. The coordination cost math, measured.

<!-- truncate -->

Multi-agent orchestration is usually sold as a pure win: put a strong model in charge, give it cheap workers, keep most of the quality for half the price. The published numbers support that, on the right tasks.

They also show the opposite result on the wrong ones. Two measurements from the same benchmark family point in opposite directions, and the difference between them is not model quality. It is task size.

This post is only about that difference. It does not cover what agent teams are or how to configure them; see [agent teams](/blog/agent-teams) for the mechanics. The question here is narrower and less discussed: when does splitting work across models cost more than running one model straight through?

## The asymmetry in one sentence

On the full BrowseComp evaluation set, where each problem requires roughly 31M tokens of reading, a Claude Fable 5 orchestrator delegating to Claude Sonnet 5 workers reached 96% of the score at 46% of the cost. That figure is Anthropic's, published alongside the pattern, and the underlying numbers are 86.8% accuracy at $18.53 per problem against 90.8% at $40.56.

On BrowseComp200, an easier subset where each problem needs roughly 0.37M tokens of reading, the same approach lost. Lance Martin, a member of technical staff at Anthropic writing up his own experiments in July 2026, reported that Fable 5 alone was cheaper than mixing Fable 5 with Sonnet 5, and that orchestration added a **60% markup for no benefit in performance**.

Same models. Same pattern. An 85x difference in reading volume per problem, and the sign of the result flips.

The mechanism is straightforward once you see it. Coordination cost is roughly fixed per handoff. Savings scale with how many tokens each worker absorbs at the cheaper rate. Divide one by the other and you get the rule:

> Delegation pays when the tokens a worker absorbs outweigh the roughly fixed cost of handing work to it.

Every question below is a way of estimating those two quantities before you spend anything.

## What coordination actually costs

Three components. The first two are Martin's framing; the third comes out of Anthropic's published cache pricing and is the one most likely to bite you in practice.

### Boundary duplication

**What it is.** Every token that crosses between models is billed at least twice. The lead writes a brief and pays for that output. The worker reads the brief and pays for it as input. The worker writes a report and pays for it. The lead reads the report and pays again.

**When it bites.** Short tasks with rich context. If the brief and the report together are a meaningful fraction of the work, you have paid double for most of what happened.

**How to reduce it.** Make briefs terse and reports structured. A worker that returns 400 tokens of findings costs a fraction of one that returns its full reasoning trace.

### Fan-out overlap

**What it is.** Parallel workers do not talk to each other. Two workers researching adjacent questions will partially duplicate each other's reading, and you pay for both copies.

**When it bites.** Wide fan-outs over a shared corpus, where the natural decomposition does not cleanly partition the source material.

**How to reduce it.** Partition by source rather than by question where you can. Overlap is a property of the split you chose, not of the models.

### The cache write you pay for repeatedly

**What it is.** A cache read costs 0.1x the base input price. A five-minute cache write costs 1.25x, and a one-hour write costs 2x. Spawn a fresh worker per request and each one starts cold, paying the write price for context it has never seen. Ten fresh workers means ten context writes at 1.25x instead of one write plus nine reads at 0.1x.

**When it bites.** Any loop that re-delegates. This is the most common way delegation savings disappear, and it looks like nothing is wrong because each individual call is cheap.

**How to reduce it.** Route repeat calls to the same worker so its cache accumulates. Anthropic's [advisor tool documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) puts a number on the same tradeoff from the other direction: caching costs more than it saves at two or fewer calls per conversation, breaks even around three, and improves after that.

One Claude Code specific worth knowing. Cache lifetime is one hour on a subscription and drops to five minutes once you are drawing on usage credits. The same delegation loop can be economical for a subscriber and wasteful for someone on credits, with no code change between them.

## The checkpoint finding, and the tension it creates

Here is the result that complicates the tidy version of this story.

Martin ran an experiment he called Parameter Golf and reported that Fable 5 paired with Sonnet 5 reached roughly 90% of Fable-5-solo's improvement at roughly 34% of the token cost. That much fits the pattern. What does not fit is his account of *why*.

The upfront advising step was not the primary benefit. Martin reported that Fable 5's initial ranking was **anti-correlated with what actually worked**. The value came from advisory checkpoints during the task, because Sonnet 5 tends to get caught hill-climbing on marginal gains with no tendency to step back and re-rank, and Fable's checkpoints supply the steering and re-prioritization.

That sits awkwardly next to a claim circulating widely: that model-tier orchestration simply beats the advisor arrangement, because an advisor has to read the lead's full conversation history as fresh input while delegation rides cached context at a fraction of the price.

Both claims have support and they are not talking about the same thing. The cost argument for orchestration is about where tokens are billed. Martin's finding is about where judgment needs to sit in time. A pattern can be the cheaper way to move tokens and still be the wrong shape for a task whose difficulty is deciding what to do next, repeatedly, as new information arrives.

We are not going to resolve that tension here, because the measurements do not resolve it. What they jointly suggest is narrower and still useful: front-loading all your expensive thinking is a weaker design than distributing it, whichever arrangement you use to do the distributing. Anthropic's own advisor documentation points the same way when it recommends an early call after some exploration and, on difficult tasks, a second call after test output exists.

## A decision rule you can apply before spending

Estimate reading volume per unit of work. That single number does most of the deciding.

| Task shape | Tokens per worker | Verdict |
| --- | --- | --- |
| Deep research across many sources | Very high | Delegate. This is the 96% at 46% case |
| Long refactor across many files | High | Delegate, partitioned by file |
| Focused lookup with a known answer location | Low | Run one model straight through |
| Short task with heavy shared context | Low | Do not delegate. Boundary cost dominates |
| Repeated small calls in a loop | Low each | Delegate only to a persistent worker |
| Anything that fits comfortably in one context window | N/A | Do not delegate |

The arithmetic is worth doing once by hand, because it is less intuitive than it sounds. Take a handoff where the lead writes a 2,000-token brief and the worker returns a 2,000-token report. At current list rates that round trip costs about $0.144 in pure overhead before the worker has done anything useful: $0.10 for the lead's output at Fable's $50 per million, $0.004 for the worker to read it at Sonnet's $2, $0.02 for the worker's report at Sonnet's $10, and $0.02 for the lead to read it back at Fable's $10. Absorb 500,000 tokens of reading in that worker at $2 per million instead of $10 and you save about $4. The handoff is noise. Absorb 20,000 tokens and you save $0.16, which the handoff has very nearly eaten. The break-even sits far lower than most people guess, but it is not at zero, and short tasks live below it. One caveat on those rates: Sonnet 5 is on introductory pricing through August 31, 2026. At its standard $3 and $15 the same handoff costs about $0.156, and the 20,000-token case stops paying for itself entirely, because the saving drops to $0.14 while the overhead rises above it.

Two guardrails on top of the table.

**Watch the multiplier on parallel instances.** Anthropic documents that [agent teams use approximately 7x more tokens](https://code.claude.com/docs/en/costs) than a standard session when teammates run in plan mode, because each teammate carries its own context window as a separate Claude instance. That is the ceiling on what fan-out can cost you when the work does not justify it.

**Measure instead of assuming.** Run `/usage` after a delegated session. On a paid plan it attributes consumption to subagents specifically, and flags cache misses when they account for 10% or more of recent usage. If your delegation is losing money, that breakdown is where it shows up first.

## What this does not establish

The BrowseComp200 and Parameter Golf results are one engineer's experiments, reported by him, not Anthropic's official published benchmarks. Treat them as directionally useful rather than as settled measurement. Anthropic's own advisor documentation is blunt about the general case: results are task-dependent, and you should evaluate on your own workload.

None of this argues against multi-agent work. The 96% at 46% result is real and it is large. The claim is narrower: the same configuration that halves your bill on a research sweep can add most of a markup back on a task that was small enough to run straight through, and you can tell which situation you are in beforehand by asking how much reading each worker will actually do.

For the broader cost picture, including which arrangement to reach for and how cache routing changes the arithmetic, see Claude Code token optimization. For sub-agent model assignment specifically, see [sub-agent best practices](/blog/sub-agent-best-practices). If Fable is the model you are budgeting, [the Fable 5 weekly allowance](/blog/fable-5-usage-credits) is the constraint that usually binds first.
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** is a planning-first workflow for any coding agent, including Claude Code, Codex, Pi and OpenCode. You approve the plan in the Cockpit before any code is written, helper agents build it in small tested slices, and an AI that did not write the code checks the result against what you asked for.

Running several agents in parallel? See [QualityLayer vs Claude Squad](https://qualitylayer.dev/compare/claude-squad) and [QualityLayer vs Conductor](https://qualitylayer.dev/compare/conductor).

[Try QualityLayer →](https://qualitylayer.dev)

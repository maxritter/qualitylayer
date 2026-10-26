---
title: "Claude Code Ultraplan: Cloud Planning to Free Your Terminal"
description: "Ultraplan offloads complex planning to the cloud with Opus 4.6. Three invocation methods, browser review UI, and leaked system prompts explained."
slug: ultraplan
date: 2026-04-06
authors:
  - max-ritter
tags:
  - guide
  - mechanics
---

Ultraplan offloads complex planning to the cloud with Opus 4.6. Three invocation methods, browser review UI, and leaked system prompts explained.

<!-- truncate -->

Your terminal is hostage. Every time Claude Code enters planning mode, your prompt is locked until the plan finishes. For a quick feature, that's fine. For a migration strategy that touches 40 files across three services, you're staring at a spinning cursor for minutes while your local machine does the heavy lifting.

Ultraplan solves this by moving the entire planning phase to Anthropic's cloud infrastructure, running Opus 4.6 in a remote container for up to 30 minutes while your terminal stays free for other work. The plan drafts in the background. You review it in a browser with inline comments and emoji reactions. Then you choose whether to execute it in the cloud (and get a PR) or teleport it back to your local session.

This is the most significant addition to Claude Code's planning system since plan mode shipped. Here's how it actually works, what the leaked source code reveals about its internals, and how to get consistently good results from it.

## What Ultraplan Actually Is

Ultraplan is a research preview feature that hands a planning task from your local CLI to a [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) session running in plan mode. The cloud session uses Anthropic's Cloud Container Runtime (CCR) with Opus 4.6, and your local terminal polls every 3 seconds for status updates.

The key differences from local planning:

| Local Plan Mode | Ultraplan |
| --- | --- |
| Runs on your machine | Runs on Anthropic's cloud infrastructure |
| Blocks your terminal | Terminal stays free for other work |
| Review in terminal scrollback | Review in browser with inline comments |
| Execute locally only | Execute in cloud (get a PR) or locally |
| Limited by your machine's resources | Up to 30-minute planning window on Opus 4.6 |

**Requirements**: You need a Claude Code on the web account (Pro, Max, Team, or Enterprise) and a GitHub repository connected.

## Three Ways to Launch Ultraplan

### 1. The Slash Command

The most explicit approach. Type `/ultraplan` followed by your prompt:

```
/ultraplan migrate the auth service from sessions to JWTs
```

This opens a confirmation dialog before launching the cloud session.

### 2. The Keyword Trigger

Include the word "ultraplan" anywhere in a normal prompt:

```
I need an ultraplan for refactoring the payment module to support multi-currency
```

Claude detects the keyword and opens the same confirmation dialog. Useful when you want to describe the task conversationally rather than as a command.

### 3. From a Local Plan

This is the smoothest path. When Claude finishes a local plan and shows the approval dialog, choose **"No, refine with Ultraplan on Claude Code on the web"** to send the draft to the cloud. No confirmation dialog needed because your selection already serves as confirmation.

This method is powerful because the cloud session starts with your local plan as context, rather than starting from scratch.

## Monitoring From Your Terminal

After launch, your CLI prompt shows a live status indicator:

| Status | Meaning |
| --- | --- |
| `◇ ultraplan` | Claude is researching your codebase and drafting the plan |
| `◇ ultraplan needs your input` | Claude has a clarifying question. Open the session link to respond |
| `◆ ultraplan ready` | The plan is ready. Open your browser to review |

Run `/tasks` in your terminal to see the ultraplan entry. From there you can open the session link, view agent activity, or hit **Stop ultraplan** to archive the cloud session and clear the indicator.

One important note: if [Remote Control](/blog/remote-control-guide) is active, it disconnects when Ultraplan starts. Both features use the `claude.ai/code` interface, and only one can be connected at a time.

## The Browser Review Interface

This is where Ultraplan differs most from local planning. Instead of reviewing a plan in terminal scrollback (where your only option is to accept, reject, or type a follow-up), you get a dedicated browser UI with three review tools:

**Inline comments**: Highlight any passage in the plan and leave a comment. This is the real upgrade. Instead of saying "the database migration section needs more detail," you point directly at the paragraph that's thin and explain what's missing. Claude revises just that section.

**Emoji reactions**: React to individual sections to signal approval or concern without writing a full comment. Quick way to mark which parts are good and which need work.

**Outline sidebar**: Jump between sections of the plan. Essential for long plans where scrolling becomes painful.

You can iterate as many times as needed. Ask Claude to address your comments, review the revised draft, leave more comments, and repeat until the plan is right.

## Four Execution Paths After Approval

Once the plan looks right, you choose where it runs:

### Path 1: Execute in the Cloud

Select **"Approve Claude's plan and start coding"** in the browser. Claude implements the plan in the same cloud session, and when it finishes, you [review the diff](https://code.claude.com/docs/en/claude-code-on-the-web#review-changes-with-diff-view) and create a pull request from the web interface. Your terminal shows a confirmation and the status indicator clears.

This is the cleanest option for self-contained changes. The cloud session has full access to your repository, and the PR creation flow is built into the web UI.

### Path 2: Implement in Current Terminal Session

Select **"Approve plan and teleport back to terminal"** in the browser. The web session archives, and your terminal shows the plan in a dialog titled "Ultraplan approved." Choose **"Implement here"** to inject the plan into your current conversation and continue from where you left off.

Best when the plan references local context (environment variables, local services, files not in the repo) that the cloud session can't access.

### Path 3: Start a Fresh Local Session

Same teleport dialog, but choose **"Start new session"** instead. This clears your current conversation and begins fresh with only the plan as context. Claude prints a `claude --resume` command so you can return to your previous conversation later.

Useful when your current session is bloated with context that would interfere with clean execution. Fresh context window, single-purpose focus.

### Path 4: Save and Cancel

Choose **"Cancel"** from the teleport dialog. Claude saves the plan to a file and prints the path. Nothing executes. You can return to it later, share it with teammates for review, or use it as a spec for manual implementation.

## What the Source Code Leak Revealed

On March 31, 2026, the [Claude Code source code leaked](/blog/claude-code-source-leak) through an npm packaging error. Among the 512,000+ lines of TypeScript exposed were the system prompts that power Ultraplan. These reveal that Ultraplan is not one system. It's at least three variants that appear to be assigned through A/B testing.

### Variant 1: simple_plan

The lightweight option. No subagents involved. The system prompt instructs Claude to:

```
Run a lightweight planning process, consistent with how you would
in regular plan mode:
- Explore the codebase directly with Glob, Grep, and Read.
- Do not spawn subagents.
When you've settled on an approach, call ExitPlanMode with the plan.
```

This is essentially regular plan mode running on cloud hardware. Faster, but less thorough.

### Variant 2: visual_plan

Same as simple_plan, plus a paragraph instructing Claude to include Mermaid or ASCII diagrams for structural changes. Diagrams show dependency order, data flow, or the shape of the change.

If your Ultraplan comes back with architecture diagrams, you got this variant. If it comes back as pure text, you didn't.

### Variant 3: three_subagents_with_critique

The deep variant. This is the one the official Piebald-AI system prompt tracker captured at version 2.1.88:

```
Produce an exceptionally thorough implementation plan using
multi-agent exploration.
1. Spawn parallel agents to explore: existing code/architecture,
   files needing modification, risks/edge cases/dependencies
2. Synthesize findings into detailed step-by-step plan
3. Spawn a critique agent to review the plan
4. Incorporate critique feedback, then call ExitPlanMode
```

Three parallel research agents explore different dimensions of your codebase simultaneously. Then a fourth agent reviews their synthesized plan for gaps. This is the variant that justifies the 30-minute window. For deep architectural work, multiple agents examining risk surfaces, dependency chains, and existing patterns produces substantially better plans than a single-pass analysis.

If you've read our guide on [sub-agent design patterns](/blog/sub-agent-best-practices), this is the explore-synthesize-critique pattern in action. Anthropic is using the same multi-agent approach for planning that advanced Claude Code users build manually.

### The Variant Lottery

The three Ultraplan system prompt variants appear to be assigned silently. Users don't choose which variant they get, and there's no UI indication of which one is running. The source code also contains a separate A/B test called `tengu_pewter_ledger` with four variants (null, trim, cut, cap) that affect general plan output verbosity, though it's unclear whether this test applies to Ultraplan sessions specifically.

The practical result: some users report Ultraplan producing thorough, multi-section plans with risk analysis, while others get thin outlines that barely improve on local planning. Whether that gap comes from system prompt variant assignment, the verbosity test, or both, the inconsistency is real and well-documented in early Hacker News discussions.

### Version History

The Piebald-AI tracker shows Ultraplan's evolution across Claude Code releases:

| Version | Change |
| --- | --- |
| v2.1.83 | First appearance as "System Reminder: Ultraplan mode" |
| v2.1.85 | Added confidentiality instruction (don't disclose how it works) |
| v2.1.88 | Can implement in same session on approval. Added teleport sentinel |
| v2.1.89 | `/ultraplan` removed from CLI commands |
| v2.1.91 | `/ultraplan` restored to CLI |
| v2.1.92 | Plan-formatting guidance updated |

The removal and restoration of the `/ultraplan` command between v2.1.89 and v2.1.91 suggests Anthropic briefly tested a keyword-only invocation model before reverting. The feature is still marked as "research preview" in official docs, and it has never appeared in Anthropic's official CHANGELOG.md. It lives behind feature flags.

## Practical Tips for Better Ultraplan Results

### 1. Front-Load Context in Your Prompt

Ultraplan's cloud session can read your codebase, but it starts cold. The more context you provide upfront, the less time it spends exploring and the better the plan:

```
/ultraplan migrate auth from express-session to JWTs.
Key files: src/middleware/auth.ts, src/routes/api/*.ts, src/models/User.ts.
Current session store is Redis. 47 protected routes.
Must maintain backward compatibility during rollout.
```

Compare this to just `/ultraplan migrate auth to JWTs`. The first version gives the planner a head start.

### 2. Use the Local Plan Path for Complex Work

For your most important plans, don't go directly to Ultraplan. Start with a local plan to get an initial outline, then send it to Ultraplan for refinement. The cloud session starts with a stronger foundation than cold exploration.

This two-step approach also means you've already validated the direction before committing cloud resources. If the local plan reveals you're solving the wrong problem, you catch that before a 30-minute Ultraplan session.

### 3. Use Inline Comments Aggressively

The browser review UI is Ultraplan's killer feature. Don't just skim the plan and hit approve. Highlight specific sections and leave targeted feedback:

- "This section assumes a single database. We have three: users, analytics, and billing."
- "The testing strategy needs integration tests for the webhook handler, not just unit tests."
- "Step 4 depends on step 7. Reorder."

Targeted inline comments produce better revisions than general feedback like "make the plan more detailed."

### 4. Choose Execution Path Based on Scope

| Situation | Best Path |
| --- | --- |
| Self-contained change, no local dependencies | Execute in cloud, get a PR |
| Needs local env vars, Docker, or local services | Teleport to terminal |
| Current session has 80%+ context usage | Start new session |
| Plan needs teammate review before execution | Cancel, save to file |

### 5. Know When NOT to Use Ultraplan

Ultraplan adds latency. The cloud session needs to clone your repo, explore the codebase, and draft a plan before you see anything. For simple changes where you already know the approach, local plan mode (Shift+Tab twice) is faster.

Use Ultraplan when: the planning itself is the hard part. Migrations, refactors affecting many files, architectural decisions with multiple valid approaches, or any task where spending 10 to 30 minutes on planning saves hours of implementation rework.

Skip Ultraplan when: you need a quick plan for a focused change, you're iterating rapidly on implementation, or you don't have a GitHub repo connected (it's a hard requirement).

## How Ultraplan Fits the Planning Ecosystem

Claude Code now has four planning tiers, each suited to different complexity levels:

| Tier | Activation | Best For |
| --- | --- | --- |
| **No plan** | Default prompting | Simple, unambiguous tasks |
| **Plan mode** | Shift+Tab twice | Medium complexity, want to review before execution |
| **Auto-planning** | Automatic on complex prompts | Claude decides when planning is needed |
| **Ultraplan** | `/ultraplan` or keyword | High complexity, need rich review and parallel exploration |

Each tier adds capability and overhead. The skill is matching the right tier to your task. For readers already using Claude Code's context management strategies, Ultraplan also offers a context advantage: the planning happens in a separate context window from your working session. Your local context stays clean for implementation.

## Current Limitations

Ultraplan is a research preview, and it shows:

**No variant selection**. You can't choose between the simple, visual, or deep planning variants. You get whichever the A/B test assigns.

**GitHub only**. You need a connected GitHub repository. GitLab, Bitbucket, and local-only repos are not supported.

**No web initiation**. You can only start Ultraplan from the CLI. Starting from the web interface directly is a feature multiple users have requested but it doesn't exist yet.

**UX friction**. Early users on Hacker News reported difficulty figuring out how to leave inline comments and described the process as "sluggish." The browser review interface works, but discoverability is rough.

**Opaque mechanics**. How file syncing works between your local machine and the cloud session isn't well-documented. Users report uncertainty about what happens if they abandon a session mid-plan.

**No official changelog entry**. Despite being functional, Ultraplan has zero entries in Anthropic's official CHANGELOG.md. It's entirely behind feature flags, which means it could change or disappear without notice.

## What Comes Next

Ultraplan represents Anthropic's bet that planning is the bottleneck in AI-assisted development. Not code generation, not testing, not deployment. Planning. The willingness to dedicate a 30-minute cloud session with Opus 4.6 just for the planning phase tells you where they think the highest-leverage moment is.

The three-variant architecture also hints at where this is heading. Right now, variant assignment is silent and random. But the infrastructure to support "choose your planning depth" is already built. A future version could let you explicitly request simple, visual, or deep planning based on your task complexity.

For now, Ultraplan is best treated as an advanced planning tool for complex, high-stakes work. Use local plan mode for daily tasks. Save Ultraplan for the plans that need to be right the first time.

---

*Using Claude Code's planning features regularly? See our complete guide to planning modes for the fundamentals, or read the [source code leak analysis](/blog/claude-code-source-leak) for the full technical breakdown of what was discovered in the leaked codebase.*
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** is a planning-first workflow for any coding agent, including Claude Code, Codex, Pi and OpenCode. You approve the plan in the Cockpit before any code is written, helper agents build it in small tested slices, and an AI that did not write the code checks the result against what you asked for.

Compare it with plan modes: [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor plan mode](https://qualitylayer.dev/compare/cursor-plan-mode).

[Try QualityLayer →](https://qualitylayer.dev)

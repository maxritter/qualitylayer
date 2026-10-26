---
title: "Claude Code Agent Teams Workflow: Plan to Production"
description: "Complete Claude Code agent teams workflow: structured planning, contract chains, and wave execution to ship production code with parallel agents."
slug: agent-teams-workflow
date: 2026-02-26
authors:
  - max-ritter
tags:
  - guide
  - agents
---

Complete Claude Code agent teams workflow: structured planning, contract chains, and wave execution to ship production code with parallel agents.

<!-- truncate -->

**Problem**: You know how to [enable Claude Code Agent Teams](/blog/agent-teams) and spawn teammates. But spawning agents without an agentic workflow produces scattered output you stitch together manually. The gap between "agent teams work" and "agent teams produce production-ready code" is a structured end-to-end process.

**Quick Win**: The workflow that makes agent teams reliable has two phases. A planning phase that eliminates assumptions and defines contracts between domains. And an execution phase that spawns agents in waves, injecting those contracts so parallel work integrates cleanly. Here is that workflow.

This is a companion guide to the [Agent Teams overview](/blog/agent-teams). If you haven't enabled agent teams or run your first team, start there. For controls and configuration, see [Advanced Controls](/blog/agent-teams-controls). For copy-paste prompt templates, see [Use Cases](/blog/agent-teams-use-cases).

## Why You Need a Workflow, Not Just a Feature

Agent Teams gives you the ability to spawn parallel Claude sessions that communicate with each other. That's a capability for agentic workflows, not a workflow itself. The capability without a process produces the same result as giving five contractors keys to a building site with no blueprints: they all build something, but nothing fits together.

Two specific things go wrong without a workflow:

1. **Assumption drift.** Each agent independently decides how to handle data shapes, naming conventions, error formats, and edge cases. The backend returns `{ notif_type: "comment" }` while the frontend expects `{ type: "COMMENT" }`. Both pass their own tests. Integration fails.
2. **Missing validation.** The lead marks all tasks complete because each agent reported success. But no one tested the full flow end-to-end. Buried errors surface when you manually test the app.

The workflow that solves both problems follows a consistent pipeline:

1. **Brain dump** your requirements (unstructured, messy, that's fine)
2. **Research and Q&A** where Claude investigates your codebase and asks you clarifying questions
3. **Structured plan** with team members, dependency chains, and acceptance criteria
4. **Fresh context** where you start a new session with just the plan
5. **Contract chain analysis** where the lead derives interfaces from the plan's dependency graph
6. **Wave execution** where agents build in parallel against injected contracts
7. **Validation loop** where the lead runs end-to-end checks against acceptance criteria

Each step exists because skipping it causes a specific class of failure. The rest of this post walks through each step.

## Phase 1: Planning (Steps 1-3)

### Step 1: Start With a Brain Dump

Don't overthink the initial input. Write what you want in plain language. Include everything you're thinking about, even if it's messy, contradictory, or incomplete. The goal is to get everything out of your head.

```
I need a payment integration for my chat app. Users should purchase
tokens and consume one token per conversation turn. I want to use
ChargeB as the payment processor. Need to touch the database for
token balances, the backend for webhook handling and token deduction,
and the frontend for a billing page. Users should get 10 free tokens
on signup. If the AI call fails, auto-refund the token.
```

This isn't a spec. It's a starting point. The value of the brain dump is that it captures intent and context that gets lost when you try to write a formal spec from scratch.

The brain dump also serves as a scope check. If you can't describe what you want in a few paragraphs, the feature is probably too large for a single agent team session. Break it down first.

### Step 2: Research and Q&A

This is the step most people skip, and it's the one that matters most. The goal: **reduce assumptions before any code gets written.**

The number one source of agent team failures isn't bad code. It's misalignment. The agent builds something different from what you wanted because it assumed incorrectly. The fix is simple: have Claude investigate your codebase and ask you clarifying questions before planning. This replaces ad-hoc [plan mode](/blog/agent-teams-controls) usage with structured team planning.

Not 2 or 3 questions. At least 10. The more questions Claude asks, the fewer assumptions leak into the plan.

```
Read the codebase. Understand our current database schema, API patterns,
auth system, and frontend component structure. Then ask me at least 10
clarifying questions about the payment integration before we plan anything.
Focus on things that could go wrong if you assumed incorrectly.
```

Claude will come back with questions like:

- Should the billing page live under the dashboard layout or be standalone?
- What token package tiers and prices do you want?
- Should we use ChargeB's hosted checkout or embedded in-app?
- What should happen in the chat UI when a user has zero tokens?
- Do you already have a ChargeB account and webhook endpoint configured?

Each question represents a potential fork in the implementation. An agent that assumes "embedded checkout" and builds accordingly will produce work that gets thrown away when you wanted hosted checkout. Ten minutes of Q&A saves hours of rework.

Claude Code's `AskUserQuestion` tool makes this fast. Most answers are multiple choice. You click through the ones where Claude's recommendation is right, and type custom answers where you need to be specific.

For more structured approaches to the planning phase, see auto-planning strategies.

### Step 3: Create a Structured Plan

With Q&A complete, formalize everything into a structured plan. This plan becomes the single artifact that drives the entire agent team execution. It needs to contain:

- **Task description and objective** so the team knows what success looks like
- **Relevant files** so agents know what exists and what to create
- **Team members** with named roles, agent types, and single responsibilities
- **Step-by-step tasks** with dependency chains (`Depends On` fields) and file ownership boundaries
- **Acceptance criteria** that are specific and measurable
- **Validation commands** that can be run to verify the work

Here is the critical structure for team orchestration:

```
## Team Orchestration
 
### Team Members
 
- Specialist
 
  - Name: builder-database
  - Role: Database schema and migrations
  - Agent Type: backend-engineer
 
- Specialist
 
  - Name: builder-api
  - Role: API endpoints and webhook handling
  - Agent Type: backend-engineer
 
- Specialist
 
  - Name: builder-frontend
  - Role: Billing page and token display components
  - Agent Type: frontend-specialist
 
- Quality Engineer (Validator)
  - Name: validator
  - Role: Validate completed work against acceptance criteria
  - Agent Type: quality-engineer
 
## Step by Step Tasks
 
### 1. Setup Database Schema
 
- **Task ID**: setup-database
- **Depends On**: none
- **Assigned To**: builder-database
- **Parallel**: false
- Create token_balances and token_transactions tables
- Add RLS policies for user isolation
 
### 2. Build API Endpoints
 
- **Task ID**: build-api
- **Depends On**: setup-database
- **Assigned To**: builder-api
- **Parallel**: true (with build-frontend once database is ready)
- Implement ChargeB webhook handler at /api/webhooks/chargeb
- Build token deduction middleware
- Handle auto-refund on AI call failure
 
### 3. Build Frontend
 
- **Task ID**: build-frontend
- **Depends On**: setup-database
- **Assigned To**: builder-frontend
- **Parallel**: true (with build-api)
- Create billing page with token balance, purchase cards, transaction history
- Add token counter to chat header
- Disable input and show buy button at zero tokens
 
### 4. Final Validation
 
- **Task ID**: validate-all
- **Depends On**: setup-database, build-api, build-frontend
- **Assigned To**: validator
- **Agent Type**: quality-engineer
- **Parallel**: false
- Verify full purchase flow end-to-end
- Verify token deduction on chat interaction
- Verify auto-refund on AI failure
```

The plan does three things: assigns file boundaries (preventing conflicts), defines a dependency chain (so the execution engine knows what to build first), and sets acceptance criteria (so validation has concrete targets).

Notice the `Depends On` fields. These are not just documentation. They form the **contract chain** that the execution phase uses to determine which agents to spawn first and what interfaces to extract between waves.

## Phase 2: Execution (Steps 4-7)

### Step 4: Start Fresh With the Plan

This step is counterintuitive but important. Start a new Claude Code session with just the plan. Don't continue in the same context window where you did the brain dump and Q&A.

Why? The planning conversation consumed context. It's full of exploratory questions, rejected ideas, and back-and-forth that's no longer relevant. The plan is a distilled artifact. It contains everything the agent team needs. The planning conversation is waste context that crowds out the implementation work.

This also means you can reuse plans. If a session fails partway through, you restart with the same plan file. No need to redo the planning work.

### Step 5: Contract Chain Analysis

Before spawning any agents, the lead analyzes the plan's dependency graph and derives the **contract chain**. This is the step that makes agent teams actually reliable for production builds.

A contract chain groups tasks into waves based on their dependencies, then identifies what each completing wave produces that the next wave needs:

```
Plan Dependency Graph:
  Task 1: Setup database       -> Depends On: none
  Task 2: Build API            -> Depends On: Task 1
  Task 3: Build frontend       -> Depends On: Task 1
  Task 4: Validate             -> Depends On: Task 1, 2, 3

Derived Contract Chain:
  Wave 1: [builder-database]   -> produces schema contract
  Wave 2: [builder-api] + [builder-frontend] in parallel
          -> both consume schema contract
          -> builder-api produces API contract
  Wave 3: [validator]          -> validates everything
```

The key insight: **no agent starts work until it has the contracts it depends on.** The database agent runs first. When it completes, it messages the lead with the actual schema definitions, table types, and relationships. That output IS the contract. The lead then pastes those concrete schemas into the spawn prompts for the API and frontend agents, so they build against real interfaces instead of inventing their own.

This is why parallel agents produce code that integrates: they are not independently guessing data shapes. They are all building against the same contract that was derived from actual completed work.

### What Gets Injected as a Contract

Contracts aren't abstract documents. They're the concrete outputs of upstream work:

- **Database completes** -> schema contract: exact table definitions, column types, foreign keys, TypeScript types
- **API completes** -> API contract: endpoint routes, request/response shapes, status codes, auth requirements
- **Shared types created** -> type contract: interfaces, enums, constants that multiple agents reference

Each downstream agent receives the relevant contracts pasted directly into their spawn prompt. Not a reference to "go read what the database agent did." The actual content. This eliminates the failure mode where an agent reads stale files or misinterprets another agent's output. It's the difference between subagent patterns where agents work in isolation and true coordinated agentic workflows where every agent builds against verified interfaces.

### Step 6: Wave Execution

With the contract chain mapped, the lead spawns agents in waves.

**Wave 1 (Foundation):** Spawn the database agent. It works on foundational tasks: schemas, shared types, configuration. The lead waits for it to complete and deliver its contract.

**Wave 2+ (Parallel):** Once the lead receives the schema contract, it spawns the API and frontend agents simultaneously. Each gets the schema contract injected into their prompt along with their task assignments and file ownership boundaries.

**Teammate spawn prompts** follow this structure:

```
You are builder-api, the backend specialist on this team.

YOUR TASKS:
- Implement ChargeB webhook handler at /api/webhooks/chargeb
- Build token deduction middleware
- Handle auto-refund on AI call failure

FILES YOU OWN (only modify these):
- src/api/webhooks/chargeb/*
- src/middleware/tokens.*
- src/lib/chargeb/*

UPSTREAM CONTRACTS (your inputs):
[Paste the actual database schema, table definitions, and TypeScript
types that the database agent produced]

CONTRACTS YOU MUST PRODUCE (your outputs):
- API endpoint signatures (routes, request/response shapes)
- Webhook payload format
- Token deduction function signature

COORDINATION:
- Message the lead when your contract is ready
- Message builder-frontend if you change any API response shape
- Mark your task complete in the shared task list when done
```

The critical elements: **file ownership boundaries** (no two agents touch the same files), **upstream contracts** (actual content, not references), and **downstream contract obligations** (what this agent must produce for others).

Enable [delegate mode](/blog/agent-teams-controls) so the lead coordinates instead of implementing. The lead's job during execution is monitoring the task list, mediating contract mismatches, and steering agents that drift off scope.

#### Brownfield Codebases

Most real work happens on existing codebases. Agent teams on brownfield projects need convention consistency. When three agents modify code simultaneously in an established codebase, they need to follow existing patterns.

The fix: have your [CLAUDE.md](/blog/claude-md-mastery) document your project conventions (naming patterns, error handling, file structure, testing approach). Agent teams load CLAUDE.md as shared runtime context, so all teammates start aligned from the first line of code. Without it, one agent writes `camelCase` API responses while another uses `snake_case` because each independently picked a convention.

### Step 7: Post-Build Validation

After teammates finish their tasks, the work isn't done. Parallel builds produce components that pass individually but may fail at integration points. The validation step catches those seam failures.

The plan's acceptance criteria and validation commands drive this step. The lead (or a dedicated quality-engineer agent) runs through each criterion:

```
All teammates have completed their tasks. Before closing out:
1. Run all validation commands from the plan
2. For each acceptance criterion, provide specific evidence of pass/fail
3. Test the complete user flow end-to-end:
   purchase tokens -> verify balance updates -> chat with agent ->
   verify token deducted -> trigger AI failure -> verify auto-refund
4. Report any integration mismatches between components
```

#### The False Positive Problem

The most dangerous post-build scenario: an agent marks all tasks complete and reports success, but buried errors exist. This happens because agents are incentivized to complete tasks and sometimes declare success prematurely.

Combat this by asking for **evidence, not confirmation**. Don't ask "did everything work?" Ask for specific outputs:

```
For each integration point, show me:
1. The exact API response from hitting POST /api/webhooks/chargeb
2. The database state after a token purchase
3. The chat UI behavior at zero tokens
4. The full test suite output

If any of these cannot be demonstrated, the task is not complete.
```

Asking for evidence forces the lead to actually verify rather than pattern-match on "looks good." Same principle behind code review: you read the diff, you don't just ask the author if it works.

#### The Fix-Retest Cycle

When validation finds issues, the cycle is straightforward:

1. Lead identifies the mismatch (e.g., webhook handler returns wrong status code)
2. Lead messages the responsible teammate or spawns a targeted fix agent
3. Fix is applied
4. Lead re-runs the affected validation checks

This cycle usually converges in 1-2 iterations if contracts were defined properly upfront. Without contracts, the fix-retest cycle spirals because each fix reveals another assumption mismatch. That is why the contract chain exists.

For structured fix cycles using dependency chains, the [builder-validator pattern](/blog/team-orchestration) formalizes this into task dependencies where validators automatically run after builders complete.

## The Complete Pipeline at a Glance

| Step | Phase | Action | Why It Matters |
| --- | --- | --- | --- |
| 1. Brain dump | Planning | Write requirements in plain language | Captures intent without premature structure |
| 2. Research & Q&A | Planning | Claude investigates codebase, asks 10+ questions | Eliminates assumptions before planning |
| 3. Structured plan | Planning | Define team, tasks, dependencies, acceptance criteria | Gives each agent a clear, non-overlapping scope |
| 4. Fresh context | Execution | Start new session with just the plan | Maximizes context, discards planning noise |
| 5. Contract chain | Execution | Derive wave order and interfaces from dependency graph | Prevents integration failures in parallel builds |
| 6. Wave execution | Execution | Spawn agents in waves with contracts injected | Fast parallel build with guaranteed compatibility |
| 7. Validation | Execution | End-to-end testing against acceptance criteria | Catches seam failures that individual tests miss |

The planning phase (Steps 1-3) takes 15-30 minutes of interactive work. The execution phase (Steps 4-7) runs largely unattended once the first wave spawns.

The ratio matters: spending 30% of your time on planning and contracts saves 70% of the rework you would otherwise do fixing integration failures after a poorly planned parallel build.

## Automating the Workflow

The seven steps above can be run manually with raw prompts. But the repetitive parts (plan formatting, contract chain derivation, wave execution, validation sequencing) are mechanical enough to codify into reusable commands.

**`/team-plan`** handles Steps 1-3. It walks Claude through codebase analysis, asks you clarifying questions, and outputs a structured plan with team members, dependency chains (`Depends On` fields), file ownership, acceptance criteria, and validation commands. The plan saves to `.claude/tasks/` as a standalone file.

**`/team-build`** handles Steps 4-7. It reads the plan file, derives the contract chain from the dependency graph (Phase 2: Contract Chain Analysis), spawns agents in waves with contracts injected into each spawn prompt (Phase 4: Contract-First Execution), and runs the validation sequence. It includes a teammate prompt template that enforces file ownership, upstream/downstream contracts, and coordination protocols.

The two commands are decoupled by design. `/team-plan` produces a plan file. `/team-build` consumes it. The plan is the interface between planning and execution. You can edit the plan between commands, reuse it across sessions, or hand it to a different team lead.

```
# Planning phase
/team-plan "Build payment integration with ChargeB for token purchases"
 
# Review the plan at .claude/tasks/payment-integration.md
# Edit if needed
 
# Execution phase (new session)
/team-build .claude/tasks/payment-integration.md
```

The commands codify the workflow, but the workflow works without them. The concepts (assumption reduction through Q&A, contract chains between waves, evidence-based validation) apply regardless of whether you use commands, raw prompts, or a custom orchestration layer.

## What to Try This Week

Pick a feature that touches at least two layers (frontend + backend, or API + database):

1. Brain dump what you want
2. Have Claude ask you 10 clarifying questions
3. Build a structured plan with team members and dependency chains
4. Start fresh and let the lead derive the contract chain
5. Watch agents build in waves against shared contracts
6. Validate the integration points with evidence, not confirmation

The first time takes longer as you build the muscle memory. By the third feature, the workflow becomes second nature and the compounding benefit kicks in: plans become reusable templates, contracts become standardized interfaces, and validation criteria accumulate into a project-wide quality baseline.

For troubleshooting common issues during execution, see [best practices and troubleshooting](/blog/agent-teams-best-practices). For copy-paste prompts across specific scenarios, see [use cases and prompt templates](/blog/agent-teams-use-cases). And if you're new to the feature itself, start with the [Agent Teams overview](/blog/agent-teams).

[Team Best Practices](/blog/agent-teams-best-practices)
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** adds a structured workflow on top of your coding agent: you approve the plan, helper agents build and test it slice by slice, and a fresh agent verifies the result against your request. The orchestration loop most agent setups end up writing by hand.

Compare it with plan modes: [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor plan mode](https://qualitylayer.dev/compare/cursor-plan-mode).

[Try QualityLayer →](https://qualitylayer.dev)

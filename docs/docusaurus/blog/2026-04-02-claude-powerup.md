---
title: "Claude Code Tutorial: /powerup Interactive Lessons Guide"
description: "/powerup is Claude Code's built-in tutorial with animated demos. Learn every feature without leaving your terminal."
slug: claude-powerup
date: 2026-04-02
authors:
  - max-ritter
tags:
  - guide
  - mechanics
---

/powerup is Claude Code's built-in tutorial with animated demos. Learn every feature without leaving your terminal.

<!-- truncate -->

**Problem**: Claude Code has more features than most developers will ever discover. Hooks, sub-agents, plan mode, rewind, worktrees, skills, MCP servers, cloud tasks. The tool ships new capabilities every week, and the average user touches maybe 20% of what's available. The learning curve is not about difficulty. It's about visibility. You can't use what you don't know exists.

On April 1, 2026, Anthropic shipped the feature designed to fix this exact problem. An in-terminal interactive tutorial system called `/powerup`. It got zero community coverage. Not because it's bad. Because a [terminal Tamagotchi](/blog/claude-buddy) stole every headline on the same day.

## What Is /powerup?

The official changelog for Claude Code v2.1.90 describes `/powerup` in one line:

> **Added `/powerup` — interactive lessons teaching Claude Code features with animated demos**

That's it. No blog post from Anthropic. No dedicated docs page. No Twitter announcement. The [commands reference page](https://code.claude.com/docs/en/commands) doesn't even list it yet as of April 2, 2026. The feature exists in the binary, confirmed in the changelog, and shipped to every user who updated to v2.1.90.

What that one-line description actually means: `/powerup` is the first official, first-party, in-terminal learning system for Claude Code. You type `/powerup`, and instead of getting a wall of text or a link to external documentation, you get interactive lessons with animated demonstrations of features, right inside the terminal session you're already working in.

This is not a third-party plugin. This is not a community project. This is Anthropic building a tutorial system directly into their CLI tool.

## Why This Matters More Than a Terminal Pet

Here's the timeline. On April 1, 2026, Anthropic shipped two releases within 22 hours of each other:

- **v2.1.89** (01:07 UTC): `/buddy`, the terminal Tamagotchi. 18 species, five rarity tiers, shiny variants, hat unlocks, stat systems with categories like CHAOS and SNARK. Someone launched a Solana memecoin ($Nebulynx) based on the rarest variant within hours.
- **v2.1.90** (23:41 UTC): `/powerup`, interactive lessons with animated demos. Zero community articles. Zero Reddit threads. Zero Twitter viral moments.

The contrast tells you everything about developer culture on April Fools' Day. A collectible pet with a 0.01% shiny legendary probability generates memecoins and reverse-engineering repos. An interactive learning system that addresses one of the most documented pain points in Claude Code adoption generates silence.

But `/buddy` is entertainment. `/powerup` is the feature you'll actually use six months from now.

## The Problem /powerup Solves

If you've been using Claude Code for more than a week, you've had the experience of discovering a feature you wish you'd known about on day one. Plan mode completely changes how you approach complex tasks. The skills system transforms Claude from a generic assistant into a specialized expert. [Voice mode](/blog/voice-mode) lets you talk to your terminal. These are not minor features. They fundamentally change how you work.

The problem is discovery. Before `/powerup`, your options for learning Claude Code looked like this:

| Resource | Type | Location | Cost |
| --- | --- | --- | --- |
| Anthropic Skilljar | Video course | External (browser) | Free |
| claude.nagdy.me | Interactive browser tutorial | External (browser) | Free |
| CC for Everyone | Course | External (browser) | $20/mo |
| Coursera (Vanderbilt) | Formal course | External (browser) | ~$50 |
| claude-code-ultimate-guide | Documentation | GitHub | Free |
| Official `/help` command | Command list | In-terminal | Free |

Notice the pattern. Every learning resource except `/help` requires you to leave the terminal and open a browser. And `/help` just lists commands without explaining what they do or showing how they work. If you want to learn how [interactive mode](/blog/interactive-mode) differs from auto mode, you need to context-switch out of the tool you're trying to learn.

`/powerup` breaks this pattern. Learn without leaving. See features demonstrated with animated examples instead of reading static descriptions. Stay in the terminal where you already are.

## How /powerup Likely Works

The exact lesson list and UI flow haven't been documented yet. The command shipped at 23:41 UTC on April 1 and the docs haven't caught up. But based on the changelog description and Claude Code's architecture, we can piece together a solid picture.

Claude Code's terminal UI runs on **React + Ink**, the framework that renders React components as terminal output. This was confirmed by the [v2.1.88 source code leak](/blog/claude-code-source-leak) that exposed the entire 512,000-line TypeScript codebase the day before `/powerup` shipped. Every rich UI element you see in Claude Code, from the `/model` selection screen to the `/config` panels to the `/diff` viewer, renders through this same Ink pipeline.

The "animated demos" in `/powerup` are almost certainly Ink components showing terminal animations: keystrokes appearing in sequence, command outputs rendering progressively, feature walkthroughs playing out as if someone were demonstrating live. Think of it as a screen recording, but rendered natively in your terminal using the same React components that power Claude Code itself.

Based on Claude Code's UI patterns with `/model` and `/config`, running `/powerup` likely opens a lesson picker where you navigate with arrow keys and Enter. Select a lesson, get a text explanation followed by an animated demonstration, then move to the next one. Keyboard-driven, no mouse required, consistent with everything else in the tool.

### What the Lessons Probably Cover

Anthropic hasn't published a curriculum. But the command is described as teaching "Claude Code features," and there's a clear set of capabilities that would benefit from visual demonstration over static documentation:

**Beginner territory**: Basic context management, `/clear` and `/compact`, the CLAUDE.md memory system, plan mode toggling with Shift+Tab, model selection.

**Intermediate territory**: The skills and custom commands system, hooks (PreToolUse, PostToolUse), sub-agent orchestration, MCP server configuration, `/rewind` and checkpointing.

**Advanced territory**: Worktrees and parallel sessions, auto mode and permission management, `/schedule` and cloud tasks, the SDK and headless mode.

The animated demo format is particularly well-suited for showing workflows that are hard to communicate in text. How does `/rewind` actually look when you use it? What happens visually when you toggle plan mode? How does a sub-agent spawn and return results? These are the kinds of interactions where watching beats reading.

## What Else Shipped in v2.1.90

`/powerup` wasn't the only thing in this release. v2.1.90 is actually one of the more substantial updates in recent Claude Code history.

**Critical fixes:**

- Fixed an infinite loop where the rate-limit dialog would crash sessions by repeatedly auto-opening
- Fixed `--resume` causing a full prompt-cache miss (regression since v2.1.69), meaning users with deferred tools or MCP servers were paying a performance penalty every time they resumed a session
- Fixed auto mode ignoring explicit user boundaries like "don't push" or "wait for X before Y"
- Fixed `Edit`/`Write` failing with "File content has changed" when a PostToolUse format-on-save hook rewrites files between consecutive edits

**Performance wins:**

- Eliminated per-turn `JSON.stringify` of MCP tool schemas on cache-key lookup
- SSE transport now handles large streamed frames in linear time (was quadratic)
- SDK sessions with long conversations no longer slow down quadratically on transcript writes
- `/resume` now loads project sessions in parallel

**Security hardening:**

- Fixed PowerShell tool permission bypasses: trailing `&` background job bypass, `-ErrorAction Break` debugger hang, archive-extraction TOCTOU vulnerability
- Removed `Get-DnsClientCache` and `ipconfig /displaydns` from auto-allow for DNS cache privacy

The `--resume` prompt-cache fix alone is significant. If you use MCP servers or deferred tools (and many power users do), every resumed session since v2.1.69 was paying a hidden performance tax. That's now fixed. The quadratic-to-linear SSE improvement matters for anyone running long sessions with heavy tool use.

## What /powerup Signals About Anthropic's Strategy

Adding an in-terminal tutorial system to a CLI tool is a product maturity signal. Early-stage developer tools assume their users will figure things out. They ship docs, maybe a getting-started guide, and let the community fill in the gaps. When a tool adds structured onboarding inside the product itself, it means the company is optimizing for the next wave of users, not just the early adopters who already know the tool inside out.

Claude Code's community has been building external learning resources for months. Interactive browser tutorials at claude.nagdy.me. A $20/month course at ccforeveryone.com. A Vanderbilt Coursera class. GitHub repos with 41 diagrams and CLI quizzes. The demand for better onboarding is documented and real.

`/powerup` is Anthropic saying: we know the learning curve is steep, and we're taking responsibility for it ourselves. Not outsourcing education to the community. Building it into the product.

There's also a connection to the source code leak. Developers literally had to reverse-engineer 512,000 lines of leaked TypeScript to discover hidden features like the [buddy pet system](/blog/claude-buddy) and the internal kairos metrics. `/powerup` is the philosophical counterweight: you shouldn't need to decompile the source to learn how to use the tool.

## The Undiscovered Feature Paradox

Claude Code ships new slash commands regularly. [Voice mode](/blog/voice-mode). [Interactive mode](/blog/interactive-mode). Plan mode. The skills system. Hooks. Sub-agents. MCP integration. Each one is powerful. Each one goes underused because discovery happens through changelogs that most users never read.

The official docs note that "not all commands are visible to every user. Some depend on your platform, plan, or environment." This means Claude Code has a class of features that are functionally invisible unless you know to look for them. `/powerup` is the first attempt to solve this from inside the tool.

Whether it succeeds depends on execution: how many lessons ship in the initial version, how frequently Anthropic adds new ones as features launch, and whether the animated demos are genuinely better than reading docs. But the direction is right. The best time to learn a feature is exactly when you need it, not in a browser course you took three weeks ago and half-forgot.

## Try It

Update to Claude Code v2.1.90 or later:

```
npm update -g @anthropic-ai/claude-code
```

Then run:

```
/powerup
```

If the command doesn't appear, check your Claude Code version with `/stats` or `claude --version`. The feature may also have plan restrictions similar to `/buddy` (Pro/Max tier). Anthropic hasn't confirmed availability across all plan tiers yet.

For developers looking to go deeper than what `/powerup` covers, our configuration guide walks through the full setup, and the Claude Code introduction covers the foundation you need before exploring advanced features.

The feature nobody talked about on April 1 might end up being the one that actually matters. A terminal pet is fun for a day. Knowing your tools is valuable forever.
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** is a planning-first workflow for any coding agent, including Claude Code, Codex, Pi and OpenCode. You approve the plan in the Cockpit before any code is written, helper agents build it in small tested slices, and an AI that did not write the code checks the result against what you asked for.

Compare it with plan modes: [QualityLayer vs Claude Code plan mode](https://qualitylayer.dev/compare/claude-code-plan-mode), [Codex plan mode](https://qualitylayer.dev/compare/codex-plan-mode) and [Cursor plan mode](https://qualitylayer.dev/compare/cursor-plan-mode).

[Try QualityLayer →](https://qualitylayer.dev)

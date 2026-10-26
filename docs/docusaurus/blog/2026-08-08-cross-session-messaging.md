---
title: "Claude Code Cross-Session Messaging: How It Works"
description: "Claude Code cross-session messaging lets your sessions message each other. How ListAgents and SendMessage work, inbound controls, and the limits."
slug: cross-session-messaging
date: 2026-08-08
authors:
  - max-ritter
tags:
  - guide
  - mechanics
---

Claude Code cross-session messaging lets your sessions message each other. How ListAgents and SendMessage work, inbound controls, and the limits.

<!-- truncate -->

Claude Code cross-session messaging lets one of your sessions deliver a message to another one. It requires Claude Code v2.1.224 or later, and Anthropic documents it as [Message your other Claude Code sessions](https://code.claude.com/docs/en/cross-session-messaging). If you run three Claude Code terminals at once, or dispatch [background sessions from agent view](/blog/agent-view), you have hit the problem it solves: a session learns something the other two need, and the only way to move it was you, retyping the context in each window.

The mechanic is narrow on purpose. A message is a piece of text one Claude writes to another. It is never conversation history and never files. The receiving Claude gets the sender's name, a reply address, and the text, and nothing else crosses. That constraint is what makes the feature safe to leave on by default, and it is also why it does not replace resuming a session when you actually want the whole conversation somewhere else.

Two things follow from the design. The exchange runs both ways, so one session can ask another a question and get the answer back in the session you are watching. And Claude can start the exchange itself, without you asking, when a change it just made affects what another session is working on.

## The two tools: ListAgents and SendMessage

Claude uses `ListAgents` to discover which agents it can reach and `SendMessage` to deliver a message to one of them by name. You never call either tool yourself; you tell Claude what the other session should know, and Claude writes the message and picks the target.

The prompt stays at the level of intent, not wording:

```
Ask the session running in my other terminal whether the migration finished
```

```
Explain what we just did to the session working on the payments API
```

What arrives on the other end is short, because Claude is summarizing rather than forwarding:

```
Schema migration finished: the new column is tenant_id, and rebasing on main is safe now.
```

To see the roster yourself, run `/list-agents` (also available as `/peers`). It lists subagents inside the current session, your other local sessions including background ones, and, while [Remote Control](/blog/remote-control-guide) is connected, your sessions on other machines labeled `Remote Control`. Agent team teammates do not appear there; Claude reaches those through the team's own roster.

A session answers to the name you set with `/rename` or the `--name` flag. Set one when you plan to message it. Otherwise Claude Code derives a name from the working directory's folder name, something like `myapp-3f`, and two sessions can end up sharing a name. The listing shows each local session's working directory to tell them apart.

`SendMessage` is the same tool Claude uses to reach [persistent subagents](/blog/persistent-subagents) and [agent team](/blog/agent-teams) teammates. That matters later: denying the tool removes all three at once.

## How a message travels between Claude Code sessions

Where the other session runs decides both the route and what Claude can send.

| Where the other session runs | How the message travels | What Claude here can send |
| --- | --- | --- |
| On this machine | Over a per-session socket, never through Anthropic servers | New messages and replies |
| On another of your machines | Through Anthropic servers, over that machine's Remote Control | Replies only |
| On Claude Code on the web | Through Anthropic servers, straight to the cloud session | Replies only |

Same-machine delivery is a local socket, so nothing leaves the box. Each session registers itself in files on disk and binds an inbox socket there, which means two sessions can reach each other only when they see the same files. A container has its own filesystem, so a session inside one and a session on the host cannot reach each other. Two sessions inside the same container still can.

Cross-machine is reply-only in both directions of the table. Claude here cannot open a conversation with a session on another machine or on the web; it can only answer a message that arrived from one. Set `isolatePeerMachines` to `true` when you want to approve every message before it leaves the machine at all:

```
{
  "isolatePeerMachines": true
}
```

That approval fires even in `bypassPermissions` mode, and a `true` from any settings scope applies. A checked-in project file can turn the requirement on but cannot turn it off.

## How the receiving session treats a SendMessage

Claude Code tells the receiving Claude that the message came from another session rather than from you, and that framing carries real restrictions. A message cannot approve anything, so it never answers a pending permission prompt on your behalf. It cannot ask for a configuration change, so `CLAUDE.md` and permission settings stay put. A slash command inside the text arrives as plain text and never executes. And anything the message asks for still runs through the receiving session's own permission rules, so you see the prompts you would normally see.

Timing is the part that makes it usable mid-task. The receiving Claude reads the message between tool calls during an active turn, so a running tool is never interrupted. When the session is idle, the message starts a new turn. Once read, it collapses to a one-line `Message from` row that `Ctrl+O` expands, and it counts toward usage exactly like a prompt you typed.

Every arriving message lands in one of three states:

- **Delivered.** Claude Code passes it to the receiving Claude.
- **Held.** Claude Code sets it aside and shows a notice. It reaches Claude only when you approve it, or when a later mode or settings change allows it.
- **Refused.** Claude Code drops it without delivering anything.

The setting that picks between them is `crossSessionInbound`, with values `accept`, `hold`, and `refuse`. When no value applies, Claude Code decides per message from the two sessions' permission modes. It sorts sessions into two classes: those that bypass permission prompts, and everything else. A session that prompts for permissions receives each message, and holds one only when the sender identifies itself as bypassing. A session that bypasses prompts holds each message for approval, and delivers one only when the sender also bypasses. Plan mode counts as bypassing where bypass permissions are available; `auto`, `acceptEdits`, and `dontAsk` count as prompting.

When that default holds a message, the receiving session opens an approval dialog showing the sender and a preview. Approve delivers that one message. Deny or dismiss drops it. Left unanswered past `dialogExpiry`, which defaults to five minutes, the dialog closes and the message is dropped. Claude Code holds at most 100 messages and drops the oldest past that.

Headless sessions are the exception worth planning for. A `claude -p` session binds an inbox socket like an interactive one and appears in the listing, but it cannot show the approval dialog, so a held message stays held. Start a long-running `-p` worker with `crossSessionInbound` set to `accept` in its `--settings` value if you want it to take messages unattended. Bare mode sessions bind no socket at all and never appear in the list.

## Turning cross-session messaging off

Receiving and sending are separate controls, so you can close one direction or both.

- **Stop receiving:** set `crossSessionInbound` to `refuse`. From project or local settings it wins over every other source; from user settings it wins unless managed settings or `--settings` set a value.
- **Stop sending and listing:** add permission deny rules naming `SendMessage` and `ListAgents`. Both take the bare tool name with no specifier.

Administrators can close both sides for an organization in managed settings:

```
{
  "permissions": {
    "deny": ["SendMessage", "ListAgents"]
  },
  "crossSessionInbound": "refuse"
}
```

Two consequences are easy to miss. Denying `SendMessage` also removes messaging to subagents and agent-team teammates, because it is one tool. And a refusing session looks identical to a normal one in its own `/status` and in other sessions' listings, so confirm the setting from the configuration rather than from the UI.

## Availability, and checking a session with /list-agents

Cross-session messaging requires Claude Code v2.1.224 or later. It runs on macOS and Linux, including Linux inside WSL 2, and is not offered on native Windows. It is not available on Amazon Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, or Microsoft Foundry. It also depends on feature-flag evaluation, so `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, or `DISABLE_GROWTHBOOK` can switch it off from your shell, a settings file's `env` map, or managed settings.

The one-command check is `/list-agents`, and it separates two different failures cleanly:

- The command is not recognized: the session does not have the feature. Start with `claude --version`.
- The command works but a send did not arrive: messaging is on and something narrower applies, such as a deny rule, the receiver's inbound controls, or the reply-only rule for sessions beyond this machine.

`/status` confirms it too. A session with messaging shows a `Peer address` row carrying its own inbox address, prefixed with `uds:`. That same path is exported to hooks and Bash commands as `CLAUDE_CODE_MESSAGING_SOCKET`, before any hook runs including `SessionStart`, which is how a script or hook posts into its own session. The socket is restricted to your operating-system user, and everything arriving on it passes the same inbound controls as any peer message, so the poster does not have to be Claude Code at all: the docs frame this for scripts and hooks, and the same mechanics admit any tool running as your user, other vendors' coding agents included. One delivery exception applies when no `crossSessionInbound` value is set: a message Claude Code can verify came from the session's own child processes is delivered directly (verification reaches exited children on Linux and WSL 2, only running processes on macOS, and nothing when Claude Code runs as a container's PID 1), while an unverifiable one is treated as carrying no permission class, which a bypassing session holds for approval. If a sandboxed Bash command cannot reach the socket, the sandbox's `sandbox.network.allowAllUnixSockets` and `sandbox.network.allowUnixSockets` settings control that.

## Limits of cross-session messaging, and when to use something else

Messages are plain text only; structured agent team protocol messages stay inside a team. Loops are throttled rather than trusted: Claude Code rate-limits repeated messages per sender, drops identical repeats arriving in a short window, and caps accepted messages waiting to be read at 50 per session. A message loop between two sessions therefore stops on its own.

The feature is for independent sessions you start and steer yourself. Claude Code has a dedicated mechanism for each neighboring case, and the right one is usually not messaging:

- Moving a whole conversation or its context to another terminal is a session resume, not a message.
- A coordinated group Claude spawns and supervises is [agent teams](/blog/agent-teams).
- Watching and steering many sessions from one place is [agent view](/blog/agent-view).
- Steering a session from your phone is Remote Control.
- Pushing external events such as CI results into a session is [channels](/blog/claude-code-channels).

Against [subagents](/blog/persistent-subagents) specifically, the trade is visibility. A subagent runs inside your session and returns a distilled result, which keeps your window clean but hides the path it took while it works. A peer session shows its entire transcript live in its own pane, takes your keyboard directly, and is still sitting there to question after the work lands. A watchable path and easy follow-up argue for sessions; a clean coordinating window argues for subagents.

Where messaging earns its place is the case none of those cover: two sessions you are running deliberately, in separate [git worktrees](/blog/worktree-guide) or separate repos, where one just landed a change the other is about to build on. That handoff used to be your job.

## Workflow patterns for multiple Claude Code sessions

The sections above are mechanics; what follows is composition. Four patterns that map cleanly onto what the channel actually guarantees:

**A monitor hands work to a worker.** Keep one session watching something long-running: production logs during a rollout, a soak test, a slow migration. When it spots an issue, do not fix it there. Its context window is full of log output, and the fix would bury the watching. Start a named worker in a new pane (`claude --name worker-fix`), then tell the monitor to describe the issue to the worker and have the fix land in its own worktree and pull request. Ask the worker to message back when it finishes; status reporting back to the session you are watching is one of the documented uses. The monitor keeps monitoring, and the fix gets a clean window.

**A goal without its baggage.** A message carries a summary and never your context, and you can turn that restriction into an instrument. To pressure-test a skill or prompt you rely on, send a second session only the goal it serves, with an instruction not to load the skill, and ask what strategy it would choose. The receiver cannot see your skill, history, or files, so its answer is independent by construction rather than by discipline. Run three or four in parallel and compare: where fresh windows converge on your current approach, the skill is confirmed; where one finds a shorter route, that is the next revision. The message boundary enforces the experiment's isolation for you.

**A coordinator that opens its own panes.** `ListAgents` only reaches sessions that already exist, and Claude Code does not spawn terminal panes. A terminal multiplexer with a CLI closes that gap: Claude runs the command that opens a pane, starts a named session in it, and then messages that session its assignment. One session becomes a coordinator for, say, reviewing every open PR in its own worktree, three panes side by side, collecting replies as each finishes. [Agent view](/blog/agent-view) already offers watching and steering many sessions from one place; the pane version differs by giving each worker its own full terminal, history, and keyboard. The subagent trade above applies in reverse: this costs more setup than a dispatch, and buys workers you can watch and interrupt individually.

**Reply-only is still a negotiation channel.** Across machines, Claude can only answer a message that arrived, never open the exchange. That is enough for real coordination once an exchange exists, provided both machines stay connected through Remote Control: a reply sent while the replying session is disconnected still arrives, but without a reply address, and the thread ends there. Within a connected exchange, two sessions on two servers can agree on an API contract or a shared testing strategy before either implements it, settling the kind of question that otherwise waits for you to carry it between terminals. The initiative restriction limits who speaks first, not how much the conversation can settle.

## Frequently asked questions

### Can I run multiple Claude Code sessions and have them talk?

Yes, on macOS or Linux with Claude Code v2.1.224 or later. Sessions on the same machine reach each other over a local socket without going through Anthropic servers, and Claude discovers them with `ListAgents` and sends with `SendMessage`. Run `/list-agents` to see the roster.

### How do I see all my Claude Code sessions?

Run `/list-agents`, or its alias `/peers`. It shows subagents in the current session, your other local sessions including background ones, and, while Remote Control is connected, your sessions on other machines and on the web. Local sessions appear only when they bind an inbox socket, which bare-mode sessions do not.

### Does a message send my conversation history or files?

No. A message is plain text one Claude writes to another. The receiver sees the sender's name, a reply address, and the text. To move context rather than a conclusion, resume the session instead.

### Can another session approve a permission prompt for me?

No. A message from another session never counts as your consent, so it cannot answer a pending prompt or change permission settings, `CLAUDE.md`, or other configuration. Anything the message asks for still triggers the receiving session's own permission prompts.

## Getting started

Name your sessions. That is the whole setup. Start the two terminals you already keep open with a name each, and the roster stops being a list of directory hashes:

```
# terminal one
claude --name migration
 
# terminal two
claude --name payments-api
 
# then, in either session
/list-agents
```

Rename a session you already started with `/rename` instead. If `/list-agents` is not recognized, check `claude --version` against the v2.1.224 requirement before anything else.

Then, the next time you finish a change one of the other windows is standing on, say so out loud instead of switching tabs. Claude writes the summary, the other session picks it up mid-task, and the context arrives without you retyping it.
<!-- qualitylayer-cta -->

---

## About QualityLayer

**QualityLayer** is a planning-first workflow for any coding agent, including Claude Code, Codex, Pi and OpenCode. You approve the plan in the Cockpit before any code is written, helper agents build it in small tested slices, and an AI that did not write the code checks the result against what you asked for.

Running several agents in parallel? See [QualityLayer vs Claude Squad](https://qualitylayer.dev/compare/claude-squad) and [QualityLayer vs Conductor](https://qualitylayer.dev/compare/conductor).

[Try QualityLayer →](https://qualitylayer.dev)

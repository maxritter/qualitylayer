---
title: Project memory
description: Save project lessons, reuse them in later sessions and choose what travels through Git.
---

# Project memory

Keep decisions, fixes and constraints so your agents find them instead of rediscovering them.

<figure class="memory-flow" aria-label="How a saved lesson reaches an agent">
  <ol>
    <li><strong>Save a lesson</strong><span>A task or agent records something worth reusing.</span></li>
    <li><strong>Find it locally</strong><span>Search matches words and meaning in your project.</span></li>
    <li><strong>Use it in context</strong><span>Your agent receives the relevant lesson text.</span></li>
  </ol>
  <figcaption>Example lesson: “Keep database migrations short and retry busy locks.”</figcaption>
</figure>

## What your agents get

| How | What happens |
| --- | --- |
| **Session lessons** | Claude Code, Codex, Pi and OpenCode receive pinned lessons and matches for the first message. If hooks are off, unavailable or too slow, delivery can be skipped |
| **Tools** | `memory_search`, `memory_read`, `memory_save` and `memory_keep`; other agents use the [CLI](#command-line) |
| **Task lessons** | Review records decisions, fixed findings and amendments; missing or failed checks never count as passing. The task's **Memory** record in Files shows what was used and saved |

Lessons are reference data, never instructions. Check an older lesson against the code before relying on it.

## Manage your lessons

In **Settings → Memory**: search, **Pin to every session** (up to five per project), **Retire**, **Still true** for lessons whose files changed, turn off **Lessons in every session**, or pause local memory.

<details>
<summary>See Memory settings</summary>

![Memory settings with project sharing and saved lessons; illustrative project data](pathname:///img/app/memory-light.webp)
![Memory settings with project sharing and saved lessons; illustrative project data](pathname:///img/app/memory-dark.webp)

</details>

## What stays local

Lessons and the search model stay on your computer; no lesson goes to an embedding service. A lesson given to your agent becomes part of its context, and a cloud agent may send that context to its provider.

## Share lessons through Git

1. In **Manage projects**, turn sharing on for a repository (off by default, this computer only).
2. Eligible lessons are written to `.qualitylayer/memories/` with a readable `LESSONS.md`. They can include lessons without recorded passing checks.
3. Review, commit and push them yourself. Memory exchange never commits or pushes.

Pilot imports and preference lessons stay private. A filter catches credentials, emails, home paths and transcripts, but review the files anyway: anyone who can read the repository can read them. Turning sharing off stops exchange; committed files stay.

## Import Pilot lessons

The Memory tab imports Pilot JSONL and Markdown files into a project you choose. They stay private and unchecked; re-importing adds no copies.

## Command line

<details>
<summary>Search, save, pin and sync from your terminal</summary>

```sh
qualitylayer memory context "database migration locks" --json
qualitylayer memory store --title "Bound migration locks" --content "Keep migration locks short, because a waiting migration blocks every write." --kind pattern --file db/migrations --json
qualitylayer memory pin <id> --json
qualitylayer memory share on --json
qualitylayer memory sync --json
```

All commands: [reference](reference/commands.md#memory).

</details>

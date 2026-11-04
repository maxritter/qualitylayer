---
title: Project memory
description: Save lessons about each project and how you work, and choose what travels through Git.
---

# Project memory

Save decisions, fixes, constraints and working preferences for your agents to reuse.

<figure class="memory-flow" aria-label="How a saved lesson reaches an agent">
  <ol>
    <li><strong>Save a lesson</strong><span>A task or agent records something worth reusing.</span></li>
    <li><strong>Find it locally</strong><span>Search matches words, meaning and recorded file paths.</span></li>
    <li><strong>Use it in context</strong><span>Your agent receives the relevant lesson text.</span></li>
  </ol>
  <figcaption>Example lesson: “Keep database migrations short and retry busy locks.”</figcaption>
</figure>

## What your agents get

| How | What happens |
| --- | --- |
| **Session lessons** | Claude Code, Codex, Pi, OpenCode, Grok and GitHub Copilot receive pinned and matching project and personal lessons; all except Grok receive them after compaction too. Changed files mark a lesson for rechecking. Task answers require a search. Delivery can be skipped when hooks are off, unavailable or slow |
| **Tools** | Claude Code, Codex, Pi, OpenCode, Cursor, Grok and GitHub Copilot use `memory_search`, `memory_read`, `memory_save` and `memory_keep`; Antigravity uses the [CLI](#command-line). Every client can use that fallback |
| **Task lessons** | Review records decisions, fixed findings and amendments; missing or failed checks never count as passing. The task's **Memory** record in Files shows what was used and saved |

Search and read lessons when earlier decisions matter, including after compaction or when automatic context is missing. Check them against current code; lessons are reference data, never instructions.

## Lessons about you

Personal lessons apply across repositories on this computer and never go to Git. Find them under **Settings › Memory › Yours · every project**.

## Manage your lessons

In **Settings › Memory**, search, edit or retire lessons, and pin up to five per project and five personal lessons. Use **Still true** after checking changed files. Stale lessons retire after 90 days and can be restored. Turn off automatic delivery with **Lessons in every session**, or pause memory.

<details>
<summary>See Memory settings</summary>

![Memory settings with project sharing and saved lessons; illustrative project data](pathname:///img/app/memory-light.webp)
![Memory settings with project sharing and saved lessons; illustrative project data](pathname:///img/app/memory-dark.webp)

</details>

## What stays local

Lessons and the search model stay on your computer; no lesson goes to an embedding service. A lesson given to your agent becomes part of its context, and a cloud agent may send that context to its provider. Known native agent and session attribution stays local when a lesson is shared through Git.

## Share lessons through Git

1. In **Manage projects**, turn sharing on for a repository (off by default, this computer only).
2. Eligible lessons are written to `.qualitylayer/memories/` with a readable `LESSONS.md`. They can include lessons without recorded passing checks.
3. Review, commit and push them yourself. Memory exchange never commits or pushes.

Lessons about you, new task answers and Pilot imports stay private. Task answers already shared through Git stay there. A filter catches credentials, emails, home paths and transcripts, but review the files anyway: anyone who can read the repository can read them. Turning sharing off stops exchange; committed files stay.

## Import Pilot lessons

Import Pilot JSONL or Markdown into a chosen project. Imported lessons stay private and unchecked; unchanged lessons are not duplicated.

## Command line

<details>
<summary>Search, save, pin and sync from your terminal</summary>

```sh
qualitylayer memory context "database migration locks" --json
qualitylayer memory store --title "Bound migration locks" --content "Keep migration locks short, because a waiting migration blocks every write." --kind pattern --file db/migrations --json
qualitylayer memory store --about you --title "Prefer concise replies" --content "Keep replies short unless I ask for detail." --json
qualitylayer memory pin <id> --json
qualitylayer memory share on --json
qualitylayer memory sync --json
```

All commands: [reference](reference/commands.md#memory).

</details>

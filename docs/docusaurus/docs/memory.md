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

## Export project lessons to Git

1. In **Manage projects**, enable **Store project lessons in Git** for the repository. It is off by default and applies to this computer.
2. **Export** writes eligible project lessons to `docs/memories/` with a readable `LESSONS.md`, beside `docs/plans/` and `docs/artifacts/`. The local store remains authoritative. A repository that still has `.qualitylayer/memories/` gets its files moved on the next export; you commit the move.
3. Review the files, then commit and push them yourself. QualityLayer never commits, pushes or pulls for memory.

Anyone who can read the repository can read exported lessons. Personal preferences, credentials, private task answers, Pilot imports and native session attribution stay outside the export. Review the files even though a privacy filter checks them. Turning export off leaves already committed files intact. Existing export consent and earlier eligible lessons keep their origin and provenance.

## Import repository records

Choose **Restore from repository** deliberately in the project where you want those records. The CLI calls this `memory import`. Repository content is untrusted evidence: inspect it and check it against current work. Search, startup and export never import records automatically. Importing from Git is separate from restoring a retired lesson in your local store.

Stable lesson identities, revisions, retirement records and replacements survive export and import across your machines. Missing repository files never retire local lessons. If two machines edited the same revision differently, both candidates remain available; choose **Compare versions**, then **Use selected version** to reconcile explicitly before re-exporting. Re-export refuses to overwrite a conflicting repository revision.

## Import Pilot lessons

Import Pilot JSONL or Markdown into a chosen project. Imported lessons stay private and unchecked; unchanged lessons are not duplicated.

## Command line

<details>
<summary>Search, save, export and import from your terminal</summary>

```sh
qualitylayer memory context "database migration locks" --json
qualitylayer memory store --title "Bound migration locks" --content "Keep migration locks short, because a waiting migration blocks every write." --kind pattern --file db/migrations --json
qualitylayer memory store --about you --title "Prefer concise replies" --content "Keep replies short unless I ask for detail." --json
qualitylayer memory pin <id> --json
qualitylayer memory share on --json
qualitylayer memory export --json
qualitylayer memory import --json
qualitylayer memory conflicts --json
qualitylayer memory reconcile <id> --revision <revision> --candidate local --json
```

All commands: [reference](reference/commands.md#memory).

</details>

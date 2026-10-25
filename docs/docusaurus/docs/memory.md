---
title: Project memory
description: Save project lessons, reuse them in later sessions and choose what travels through Git.
---

# Project memory

Keep decisions, fixes and constraints for later work. Your agents can search these lessons instead of rediscovering them.

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
| **Session lessons** | With the installed hooks or plugins on, Claude Code, Codex, Pi and OpenCode can receive pinned lessons and matches for the first message in a repository |
| **After compaction** | A supported client’s compaction hook can restore that lesson block. If hooks are off, unavailable or too slow, delivery can be skipped |
| **Search, save and keep tools** | `memory_search`, `memory_read`, `memory_save` and `memory_keep` let an agent retrieve, save, confirm or retire what it chooses, with a reason. Claude Code and Codex get them at install; Pi and OpenCode through their plugins. Other agents use the [CLI](#command-line) |
| **Task lessons** | In Review, QualityLayer records decisions, fixed findings and plan amendments, with evidence when available. Missing or failed checks never count as passing. The agent also rewrites, retires or confirms the lessons on files the task changed. A task’s **Memory** record in Files shows what each step used and saved, and what Review kept |

Lesson text is labelled as saved reference data. It does not replace your request or the agent’s instructions. Search with concrete project terms, and check an older lesson against the current code before using it.

## Manage your lessons

Open **Settings → Memory**.

| To | Use |
| --- | --- |
| Find a saved lesson | Search by a phrase or by what you need to do |
| Keep a lesson in session context | Open it and enable **Pin to every session**; up to five pins per project |
| See lessons whose files changed since they were checked | **Lesson state: Sources changed**. The next task that changes those files keeps them; **Still true** in a lesson confirms it now |
| Stop using an outdated lesson | **Retire**; its history stays available. A lesson whose files were all deleted retires itself, and **Use in future tasks** restores it |
| Stop automatic session lessons | Turn off **Lessons in every session** |
| Pause capture and retrieval | Pause local memory; saved lessons stay |
| Choose repositories for Git exchange | **Manage projects** |

<details>
<summary>See Memory settings</summary>

![Memory settings with project sharing and saved lessons; illustrative project data](pathname:///img/app/memory-light.webp)
![Memory settings with project sharing and saved lessons; illustrative project data](pathname:///img/app/memory-dark.webp)

</details>

## What stays local

| Part | Where the text goes |
| --- | --- |
| **Storage and search** | Lessons and the search model stay on your computer. The bundled model finds meaning locally; no lesson goes to an embedding service |
| **Your coding agent** | Lessons given to an agent become part of its context. A cloud agent may send that context to its provider under its own settings and terms |
| **Git sharing** | Only repositories where you turn sharing on exchange lesson files. This is separate from encrypted task sharing |

## Share lessons through Git

1. Open **Manage projects** and turn sharing on for a repository. It starts off and applies to this computer only.
2. QualityLayer writes **eligible project lessons** to `.qualitylayer/memories/`, with any evidence attached. These can include lessons without recorded passing checks.
3. Review the files, then commit and push them yourself. Memory exchange never commits or pushes.

Beside your lesson files, `LESSONS.md` lists your current lessons in plain text, so reviewers read a changed lesson in the pull request. QualityLayer rewrites it and never reads it back; retired lessons are left out.

Pilot imports and preference lessons stay private. A publication filter checks for credential patterns, email addresses, home paths, prompts and transcripts. It is not a guarantee, so review the files before sharing.

Anyone who can read the repository can read these lessons. Turning sharing off stops exchange; it does not erase files already committed.

## Import Pilot lessons

The Memory tab imports Pilot JSONL exports and Markdown knowledge files into a project you choose. Imported lessons stay private and unchecked. Importing the same file again adds no copies.

## Command line

Run project commands inside the repository. Any agent that can run shell commands can use them.

<details>
<summary>Search, save, pin and sync from your terminal</summary>

```sh
qualitylayer memory context "database migration locks" --json
qualitylayer memory store --title "Bound migration locks" --content "Keep migration locks short, because a waiting migration blocks every write." --kind pattern --file db/migrations --json
qualitylayer memory read <id> --json
qualitylayer memory confirm <id> --reason "Still holds after the lock change" --json
qualitylayer memory pin <id> --json
qualitylayer memory import-pilot lessons.jsonl --json
qualitylayer memory share on --json
qualitylayer memory sync --json
```

`sync` exchanges lesson files with the checkout. See the [full command reference](reference/commands.md#memory) for search, retirement, imports and sharing controls.

</details>

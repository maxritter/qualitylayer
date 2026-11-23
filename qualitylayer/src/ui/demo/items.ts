// What needs a person on the demo's smaller tasks, in the shape the server computes (core/items.ts):
// a bug at Plan, a change handed back as too small, the stop of a task whose checks did not settle,
// and the two quick items of a task waiting for its final approval. Usage-based billing is the
// demo task of `task/` and asks its own. Every sentence is illustrative.

import type { Comment } from "../../core/gate/comments.ts"
import {
  type DecidedGate,
  type Item,
  KIND_LABEL,
  resolveItem,
  type StepChecks,
  type StepParts,
} from "../../core/items.ts"
import { item } from "./story.ts"

/**
 * The states the demo shows besides the plain first look, asked for in the address:
 * `?state=bug` (a bug the agent is reproducing in Codex) and `?state=small` (a change handed back as
 * too small for a plan), and `?state=long` (a project and a task with names far longer than a row
 * has room for, to see how every list holds them).
 */
export type DemoVariant = {
  state?: "bug" | "small" | "long"
  /**
   * The demo as a visitor first meets it (Max, 10 November 2026): Home holds three things that need
   * you and three running tasks. The other tasks and asks are kept; `?tasks=all` lists them.
   */
  home?: "calm"
}

const STATES = ["bug", "small", "long"] as const

/** What the agents proved at Plan, for its violet line. */
const checks = (plan: string[]): StepChecks => ({ plan })

/** The open tasks the calm Home leaves out; every one is listed with `?tasks=all`. */
export const CROWD_TASKS: ReadonlySet<string> = new Set([
  "queue",
  "invoice",
  "sso",
  "tokens",
  "reindex",
  "pager",
  "header",
])

/**
 * The address's own first look: calm, unless it asks for every task (`?tasks=all`). `everything` is
 * the browser suite's server, whose specs open every task; there `?tasks=calm` asks for the first look.
 */
export function calmFrom(search: string, everything = false): DemoVariant {
  const asked = new URLSearchParams(search).get("tasks")
  if (asked === "all") return {}
  return asked === "calm" || !everything ? { home: "calm" } : {}
}

export function variantFrom(search: string): DemoVariant {
  const state = STATES.find((s) => s === new URLSearchParams(search).get("state"))
  return state !== undefined ? { state } : {}
}

/** What an item says, as its digest: the demo has no documents to hash. */
const stamp = (items: Item[]): Item[] =>
  items.map((it) => {
    const children = it.children !== undefined ? stamp(it.children) : undefined
    return {
      ...it,
      ...(children !== undefined ? { children } : {}),
      digest: `${it.kindLabel}|${it.what}|${it.why ?? ""}|${(children ?? []).map((c) => c.digest).join(",")}`,
    }
  })

/** A bug's Plan: When, Today, Expected, Must keep working, then Done means. */
const BUG_ITEMS = (): Item[] => [
  item(
    "plan:asked:1",
    "plan",
    "asked",
    "An export of more than 100,000 rows times out after 30 seconds",
    {
      family: "decide",
      kindLabel: "Is this the bug?",
      answers: { options: ["agree", "change"], labels: { agree: "Yes", change: "Not quite" } },
      media: {
        kind: "facts",
        rows: [
          { label: "When", value: "An account with 120,000 rows exports to CSV" },
          {
            label: "Today",
            value: "The request times out after 30 s; the user gets an empty file",
          },
          { label: "Expected", value: "The export finishes and downloads, at any size" },
          {
            label: "Must keep working",
            value: "Small exports stay instant; the CSV columns and order do not change",
          },
        ],
      },
    },
  ),
  item("plan:done:1", "plan", "done", "The checks the fix must pass", {
    family: "decide",
    kindLabel: `${KIND_LABEL.done} · 3`,
    count: 3,
    answers: { options: ["agree"] },
    children: [
      "A 120,000-row export finishes and downloads",
      "A test reproduces the timeout first and passes after the fix",
      "A 50-row export is as fast as before",
    ].map((outcome, index) =>
      item(`plan:done:1:${index + 1}`, "plan", "done", outcome, {
        family: "decide",
        answers: { options: [] },
      }),
    ),
  }),
]

/** The two extra tasks the Plan states add: a bug at Plan, and a change handed back as too small. */
export const BUG_TASK = "export-timeout"
export const SMALL_TASK = "rename-heading"

/** What the extra tasks ask of you, and what they say besides: stamped and in the state the answers give them. */
export function extraTask(
  id: string,
  comments: Comment[],
): { items: Item[]; parts: StepParts; checked: StepChecks } | null {
  const env = { comments, decided: [] as DecidedGate[] }
  if (id === BUG_TASK)
    return {
      items: stamp(BUG_ITEMS()).map((it) => resolveItem(it, env)),
      parts: {},
      checked: checks([
        "reproduced the timeout with 120,000 rows",
        "cause: one database query per row",
      ]),
    }
  if (id === SMALL_TASK)
    return {
      items: stamp(SMALL_ITEMS()).map((it) => resolveItem(it, env)),
      parts: {},
      checked: checks([]),
    }
  const nothing = { parts: {}, checked: checks([]) }
  // Queue migration's Plan waits and the agents found nothing for you to look at.
  if (id === "queue") return { items: [], ...nothing }
  const stopped = STOP_ITEMS[id]
  if (stopped !== undefined)
    return { items: stamp([stopped()]).map((it) => resolveItem(it, env)), ...nothing }
  return null
}

/** What two checking rounds could not settle on the task Home lists with it: the final review lists it, with Accept and Fix it. */
const STOP_ITEMS: Record<string, () => Item> = {
  // Two checking runs ended on the same failing scenario; the person's review in Verify lists it.
  sso: () =>
    item(
      "verify:open:sso",
      "verify",
      "found",
      "A removed group still grants access after two checking runs",
      {
        family: "fix",
        kindLabel: "Still open after checking twice",
        why: "First check: the session cache still holds the removed group for an hour · Recheck: the cache is cleared on sync, but a user with two groups keeps the removed one. The build session fixed it between the two.",
        blocking: true,
      },
    ),
}

/**
 * Rate-limit the export API waits for its final approval with two quick items: one only the person
 * can confirm and one the checks found. Home answers both in place (Home 1a) and takes them back.
 */
export const EXPORT_TASK = "export"
const EXPORT_ITEMS = (): Item[] => [
  item(
    "verify:confirm:done:2",
    "verify",
    "confirm",
    "A refused export shows the wait in seconds on the real page",
    { family: "confirm", blocking: true },
  ),
  item(
    "verify:found:1",
    "verify",
    "found",
    "A retry-after under one second reads 0 in the export dialog",
    {
      family: "fix",
      why: "`export/dialog.tsx:48` · the header says 0.4 s; the dialog rounds it down to 0.",
    },
  ),
]
export const exportItems = (comments: Comment[]): Item[] =>
  stamp(EXPORT_ITEMS()).map((it) => resolveItem(it, { comments, decided: [] }))

/** A change too small for a plan, handed back with a ready prompt. */
const SMALL_ITEMS = (): Item[] => [
  item(
    "plan:handback:1",
    "plan",
    "handback",
    "Rename the heading 'Links' to 'Opening links' in docs/app.md",
    {
      family: "answer",
      why: "One heading in one file: a plain request to your agent is faster and cheaper than a plan.",
      answers: { options: [] },
      media: {
        kind: "prompt",
        text: 'In docs/docusaurus/docs/app.md, rename the heading "Links" to "Opening links" and update the two anchors that point to it.',
      },
    },
  ),
]

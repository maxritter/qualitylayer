// What the sidebar's project list shows, as pure functions: each project's label, two letters and
// color; the projects in the person's order; each project's open tasks in the order that matters
// (your turn first, an open pull request last); the counts a folded header keeps; the open task
// kept under a fold or a filter; and the filter applied per project. The components only draw it.

import type { ProjectColor, ProjectLooks } from "../../core/project-look.ts"
import type { Project, TaskSummary } from "../api.ts"
import { agentInfo, type Need, type TaskFilter, teamStageWord } from "../model.ts"
import type { ManagedRunGroups } from "../run-attention.ts"
import { type ActivityWindow, activityWord } from "./activity.ts"

export { projectView } from "./project-view.ts"

/** The row's list in the sidebar's own words: the group the task sorts into. */
export type RowGroup = "you" | "running" | "shipped"

/** A project's id with the name it shows and the folder it lives in. */
export type ProjectRef = Pick<Project, "id" | "name"> & Partial<Pick<Project, "lastSeen" | "paths">>

/** What a tile and a header need of a project. */
export type ProjectFacts = {
  id: string
  /** The look's name, else the project's own. */
  label: string
  letters: string
  color: ProjectColor
  /** The first folder of the project, for the header's tooltip. */
  folder: string
}

/** Past rows listed under one project's fold before "N more". */
export const PAST_SHOWN = 12

// ---------------------------------------------------------------- labels and colors

/** The name a project shows: the look's label when it has one, else the project's own. */
export function projectLabel(project: Pick<Project, "id" | "name">, looks: ProjectLooks): string {
  const label = looks.projects[project.id]?.label?.trim()
  return label !== undefined && label !== "" ? label : project.name
}

/**
 * Two letters for the tile: the first letters of the first two words of the name (split on
 * `-_ .`), else its first two characters.
 */
export function projectLetters(name: string): string {
  const trimmed = name.trim()
  const words = trimmed.split(/[-_ .]+/).filter((w) => w !== "")
  const letters =
    words.length >= 2
      ? `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`
      : Array.from(trimmed).slice(0, 2).join("")
  return letters === "" ? "?" : letters.toUpperCase()
}

/**
 * A project's color before the person picks one: one quiet slate for every project, so the
 * sidebar reads calm; a color is the person's own choice in the project's menu.
 */
export function defaultColor(_id: string): ProjectColor {
  return "slate"
}

/** The person's color for a project, else its default. */
export function projectColor(id: string, looks: ProjectLooks): ProjectColor {
  return looks.projects[id]?.color ?? defaultColor(id)
}

export function projectFacts(project: ProjectRef, looks: ProjectLooks): ProjectFacts {
  const label = projectLabel(project, looks)
  return {
    id: project.id,
    label,
    letters: projectLetters(label),
    color: projectColor(project.id, looks),
    folder: project.paths?.[0] ?? "",
  }
}

// ---------------------------------------------------------------- order

/** The last time anything happened in a task. */
const taskActivity = (t: TaskSummary): number =>
  Math.max(t.created, t.waitingSince ?? 0, t.session?.heartbeat ?? 0)

/** The projects the list knows: the registered ones, then any a task names that the list does not. */
export function knownProjects(projects: Project[], tasks: TaskSummary[]): ProjectRef[] {
  const out: ProjectRef[] = [...projects]
  const seen = new Set(projects.map((p) => p.id))
  for (const t of tasks) {
    if (seen.has(t.project)) continue
    seen.add(t.project)
    out.push({ id: t.project, name: t.projectName })
  }
  return out
}

/** The saved order first, then the projects not in it by most recent activity. */
export function orderProjects(
  projects: ProjectRef[],
  tasks: TaskSummary[],
  looks: ProjectLooks,
): ProjectRef[] {
  const activity = new Map<string, number>()
  for (const p of projects) activity.set(p.id, p.lastSeen ?? 0)
  for (const t of tasks)
    activity.set(t.project, Math.max(activity.get(t.project) ?? 0, taskActivity(t)))
  const byId = new Map(projects.map((p) => [p.id, p]))
  const saved: ProjectRef[] = []
  for (const id of looks.order) {
    const p = byId.get(id)
    if (p !== undefined && !saved.includes(p)) saved.push(p)
  }
  const rest = projects
    .filter((p) => !saved.includes(p))
    .sort(
      (a, b) =>
        (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) || a.name.localeCompare(b.name),
    )
  return [...saved, ...rest]
}

// ---------------------------------------------------------------- tasks of one project

/**
 * Where an open task sorts: 0 your turn, 1 stopped, 2 working, 3 quiet, 4 pull request open with
 * nothing waiting. The same state the row's mark shows.
 */
export type Attention = 0 | 1 | 2 | 3 | 4

export type ProjectRow = { task: TaskSummary; group: RowGroup; attention: Attention }

/** What a folded header keeps in view: the amber count, else a working ring, else the open count. */
export type FoldedSign =
  | { kind: "you"; n: number }
  | { kind: "working" }
  | { kind: "open"; n: number }
  | null

export type ProjectGroup = ProjectFacts & {
  folded: boolean
  /** Its open tasks in attention order (after the filter), none under a fold except the open task. */
  rows: ProjectRow[]
  /** Closed tasks, newest closing event first, when the project's fold is open; the open task stays in `rows`. */
  pastRows: ProjectRow[]
  /** Past rows beyond the ones listed. */
  pastMore: number
  /** "Shipped 3 · archived 1"; null when there is nothing past, or a filter hides the fold. */
  foldLabel: string | null
  /** The fold's kinds as icon, word and count (empty when `foldLabel` is null). */
  foldParts: FoldPart[]
  foldOpen: boolean
  sign: FoldedSign
  /** Every open task of the project, whatever the filter (the header's count). */
  openCount: number
  /** "Nothing open", "No tasks yet" or null when rows (or a filter) say enough. */
  empty: "Nothing open" | "No tasks yet" | null
  /** Nothing open: the name reads quieter. */
  quiet: boolean
}

export type ProjectView = {
  groups: ProjectGroup[]
  /** Hidden projects, in order, for the "Hidden projects" fold. */
  hidden: ProjectFacts[]
  /** How many projects the filter left out because nothing in them matches. */
  quietCount: number
  /** "2 projects have nothing that needs you."; null without a filter or a quiet project. */
  quietNote: string | null
  filtering: boolean
  /** No project at all: the first-run card. */
  empty: boolean
}

/** "needs you", "is running", "shipped" or "matches": what a project had nothing of. */
const NOTHING_WORD: Record<TaskFilter["need"], string> = {
  "": "matches",
  you: "needs you",
  running: "is running",
  shipped: "shipped",
}

/** "1 project has nothing that needs you." */
export function quietNote(count: number, need: TaskFilter["need"]): string | null {
  if (count <= 0) return null
  return `${count} ${count === 1 ? "project has" : "projects have"} nothing that ${NOTHING_WORD[need]}.`
}

/** "Shipped 3 · archived 1", "Archived 2"; null when both are zero. */
export function pastLabel(shipped: number, archived: number): string | null {
  if (shipped === 0 && archived === 0) return null
  if (shipped === 0) return `Archived ${archived}`
  return archived === 0 ? `Shipped ${shipped}` : `Shipped ${shipped} · archived ${archived}`
}

/** One kind under a project's fold: its icon (a lucide name), its word and how many. */
export type FoldPart = {
  icon: "circle-check-big" | "git-merge" | "archive"
  word: "Settled" | "Shipped" | "Archived"
  n: number
}

/** The fold's parts in order, Settled first and only when there is any; a kind with none is left out. */
export function foldParts(counts: {
  settled?: number
  shipped: number
  archived: number
}): FoldPart[] {
  const all: FoldPart[] = [
    { icon: "circle-check-big", word: "Settled", n: counts.settled ?? 0 },
    { icon: "git-merge", word: "Shipped", n: counts.shipped },
    { icon: "archive", word: "Archived", n: counts.archived },
  ]
  return all.filter((part) => part.n > 0)
}

export type ProjectViewInput = {
  tasks: TaskSummary[]
  projects: Project[]
  looks: ProjectLooks
  filter: TaskFilter
  /** Project ids the viewer folded. */
  folded: ReadonlySet<string>
  /** Project ids whose Shipped and archived fold the viewer opened. */
  doneOpen: ReadonlySet<string>
  /** The task on screen: it stays listed under a fold, a filter and a hidden project. */
  openId: string | null
  now: number
  /** What Find typed: tasks whose title or project name has every word, shipped and archived too. */
  query?: string
  managed?: ManagedRunGroups
  activity?: ActivityWindow
}

/** Every word of `query` is somewhere in `text`, ignoring case; a blank query matches. */
export function matchesQuery(text: string, query: string): boolean {
  const hay = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

/**
 * Status grouping lists tasks across projects: the tasks of a hidden project stay out of it, except
 * the one on screen and the ones of a project the person asked for by name.
 */
export function tasksOfShownProjects(
  tasks: TaskSummary[],
  looks: ProjectLooks,
  openId: string | null,
  onlyProject: string,
): TaskSummary[] {
  return tasks.filter(
    (t) =>
      looks.projects[t.project]?.hidden !== true || t.id === openId || t.project === onlyProject,
  )
}

// ---------------------------------------------------------------- one-line rows and the chip

/** The recorded workflow stage or terminal state; last-change time is available separately. */
export function rowEnd(task: TaskSummary): string {
  if (task.archived) return "Archived"
  if (task.handedBack !== undefined) return "Handed back"
  if (task.earlier === true) return "Earlier workflow"
  if (task.type === "chat" && task.stage !== "shipped" && task.stage !== "abandoned") return "Chat"
  return teamStageWord(task.stage)
}

/** The words on the filter chip, in the View menu's wording: what Find typed, the Show choice, the agent, the project. */
export function chipWords(f: {
  query: string
  need: Need
  agent: string
  project: string
  activity?: ActivityWindow
}): string[] {
  const query = f.query.trim()
  const show = { you: "What needs you", running: "Running", shipped: "Shipped" }
  return [
    query !== "" ? `Name has “${query}”` : "",
    f.need === "" ? "" : show[f.need],
    f.agent === "" ? "" : agentInfo(f.agent).name,
    f.project,
    f.activity !== undefined && f.activity !== "any" ? activityWord(f.activity) : "",
  ].filter((part) => part !== "")
}

// ---------------------------------------------------------------- reordering

/**
 * `id` placed beside `next` in the full order (all projects, hidden ones too): before it, or after.
 * The projects the person cannot see keep their places among themselves.
 */
function placed(full: string[], id: string, next: string, after: boolean): string[] {
  const rest = full.filter((p) => p !== id)
  const at = rest.indexOf(next)
  if (at === -1) return full
  rest.splice(after ? at + 1 : at, 0, id)
  return rest
}

/**
 * The full order after `id` moves one step (-1 up, 1 down) among the projects on show; null at the
 * ends or for an id that is not on show.
 */
export function movedOrder(
  full: string[],
  shown: string[],
  id: string,
  step: -1 | 1,
): string[] | null {
  const at = shown.indexOf(id)
  const next = shown[at + step]
  if (at === -1 || next === undefined) return null
  return placed(full, id, next, step === 1)
}

/**
 * The full order after `id` is dropped on `onto`: below it when it came from above, else above it;
 * null when nothing moves.
 */
export function droppedOrder(
  full: string[],
  shown: string[],
  id: string,
  onto: string,
): string[] | null {
  const from = shown.indexOf(id)
  const to = shown.indexOf(onto)
  if (id === onto || from === -1 || to === -1) return null
  return placed(full, id, onto, from < to)
}

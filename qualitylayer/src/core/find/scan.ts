// An explicit, index-free lookup over the committed plans. Scans README
// frontmatter and document text under docs/plans/ in every checkout listed by
// `git worktree list`, so an in-flight task on an unmerged branch is found
// from the main checkout too. v11 single-file plans are read-only entries.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Answers } from "../config-values.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { worktrees } from "../git/repo.ts"
import { plansDir, type RepoRef } from "../paths.ts"
import { listTasks, readmePath } from "../task/store.ts"

export type Entry = {
  answers: Answers
  /** The task's slug. */
  task: string
  /** `<project id>~<slug>`: the id the App, `status` and the events name the task by. */
  id: string
  /** The step the task is at (its stage); null for a v11 plan, which has none. */
  step: string | null
  title: string
  /** Which workflow wrote it: today's, or a v11 single-file plan. */
  flow: "current" | "v11"
  status: string
  shipped: string | null
  path: string
  touched: string[]
  created: number
  /** v11 single-file plans are listed, never touched. */
  readonly: boolean
  match?: string
}

function v11Entry(repo: RepoRef, name: string, path: string, markdown: string): Entry | null {
  const status = markdown.match(/^Status:\s*(\w+)/m)?.[1]
  if (status === undefined) return null
  const title = markdown.match(/^# (.+)$/m)?.[1]?.trim() ?? name
  const date = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
  return {
    answers: "app",
    task: name.replace(/\.md$/, ""),
    id: `${repo.id}~${name.replace(/\.md$/, "")}`,
    step: null,
    title,
    flow: "v11",
    status: status.toLowerCase(),
    shipped: status === "VERIFIED" ? date : null,
    path,
    touched: [],
    created: date !== null ? Date.parse(date) : 0,
    readonly: true,
  }
}

async function docsText(ctx: Ctx, dir: string): Promise<string> {
  const parts: string[] = []
  for (const name of (await ctx.fs.readdir(dir)).sort()) {
    if (name.endsWith(".md")) parts.push(await ctx.fs.readFile(join(dir, name)))
  }
  return parts.join("\n")
}

function snippet(text: string, query: string): string | undefined {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return undefined
  const start = Math.max(0, index - 60)
  return text
    .slice(start, index + query.length + 60)
    .replace(/\s+/g, " ")
    .trim()
}

async function collectTasksFromRoot(
  ctx: Ctx,
  repo: RepoRef,
  root: string,
  entries: Map<string, Entry>,
  texts: Map<string, string>,
): Promise<void> {
  for (const task of await listTasks(ctx, { ...repo, root })) {
    if (entries.has(task.slug)) continue
    const frontmatter = parseDoc(await ctx.fs.readFile(readmePath(task))).frontmatter ?? {}
    entries.set(task.slug, {
      answers: task.answers,
      task: task.slug,
      id: `${repo.id}~${task.slug}`,
      step: task.stage,
      title: task.title,
      flow: "current",
      status: typeof frontmatter.status === "string" ? frontmatter.status : task.stage,
      shipped: frontmatter.shipped != null ? String(frontmatter.shipped) : null,
      path: task.dir,
      touched: Array.isArray(frontmatter.touched) ? frontmatter.touched.map(String) : [],
      created: task.created,
      readonly: false,
    })
    texts.set(task.slug, await docsText(ctx, task.dir))
  }
}

async function collectV11FromRoot(
  ctx: Ctx,
  repo: RepoRef,
  root: string,
  entries: Map<string, Entry>,
  texts: Map<string, string>,
): Promise<void> {
  const plans = plansDir(root)
  if (!(await ctx.fs.exists(plans))) return
  for (const name of await ctx.fs.readdir(plans)) {
    if (!name.endsWith(".md")) continue
    const path = join(plans, name)
    const markdown = await ctx.fs.readFile(path)
    const entry = v11Entry(repo, name, path, markdown)
    if (entry !== null && !entries.has(entry.task)) {
      entries.set(entry.task, entry)
      texts.set(entry.task, markdown)
    }
  }
}

function filterScannedEntries(
  ctx: Ctx,
  entries: Map<string, Entry>,
  texts: Map<string, string>,
  options: ScanOptions,
): Entry[] {
  let list = [...entries.values()]
  if (options.status !== undefined) list = list.filter((e) => e.status === options.status)
  if (options.sinceMs !== undefined) {
    const from = ctx.clock.now() - options.sinceMs
    list = list.filter((e) => e.created >= from)
  }
  const query = options.query?.trim() ?? ""
  if (query !== "") {
    list = list.flatMap((e) => {
      const haystack = `${e.title}\n${e.touched.join(" ")}\n${texts.get(e.task) ?? ""}`
      const match = snippet(haystack, query)
      return match !== undefined ? [{ ...e, match }] : []
    })
  }
  return list.sort((a, b) => b.created - a.created || b.task.localeCompare(a.task))
}

export type ScanOptions = { query?: string; status?: string; sinceMs?: number }

export async function scan(ctx: Ctx, repo: RepoRef, options: ScanOptions = {}): Promise<Entry[]> {
  const checkouts = await worktrees(ctx, repo.root)
  const roots = [repo.root, ...checkouts.map((w) => w.path).filter((p) => p !== repo.root)]
  const entries = new Map<string, Entry>()
  const texts = new Map<string, string>()

  for (const root of roots) {
    if (!(await ctx.fs.exists(root))) continue
    await collectTasksFromRoot(ctx, repo, root, entries, texts)
    await collectV11FromRoot(ctx, repo, root, entries, texts)
  }
  return filterScannedEntries(ctx, entries, texts, options)
}

/** "30d", "12h", "2w" → milliseconds. */
export function parseDuration(text: string): number | null {
  const match = text.match(/^(\d+)([hdw])$/)
  if (match === null) return null
  const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2] as "h" | "d" | "w"]
  return Number(match[1]) * unit
}

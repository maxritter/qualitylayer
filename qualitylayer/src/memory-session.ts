// The lesson block a session starts with: the pinned lessons of its repository and the ones that
// match its first message, fenced as untrusted text and cut to 3 KiB. The prompt hook, the
// compaction hook and the Pi and OpenCode plugins all ask for it here. `memory-sessions.json` in the
// QualityLayer home remembers which sessions were served, by lesson id and time, never by message.

import { realpathSync } from "node:fs"
import { basename, join } from "node:path"
import type { MemoryService } from "./core/memory/index.ts"
import { composeHits } from "./core/memory/ranking.ts"
import { resolveRepo } from "./core/paths.ts"
import type { Ctx } from "./ctx.ts"
import { ANSWER_TAG, type MemoryPreview, PERSONAL_PROJECT } from "./memory-contracts.ts"
import { memoryService } from "./memory-runtime.ts"
import {
  fitSessionBlock,
  HINT,
  MATCHED_MAX,
  PINNED_MAX,
  readSessions,
  SESSION_ID,
  type SessionEntry,
  updateSessions,
} from "./memory-session-store.ts"

export type BlockReason = "first" | "compact"
export type SessionBlock = { text: string; ids: string[] } | { text: null; issue?: string }

const MESSAGE_MAX_CHARS = 2000
const LOOKUP_TIMEOUT_MS = 2000
const ISSUE = "Project memory is unavailable. The message goes on; check Settings → Memory."

/**
 * Marks a session as compacted: the next return point sends it its lessons again. With
 * `servedOnly`, a session the lookup never saw is left unmarked, so it gets no block.
 */
export async function markCompacted(
  ctx: Ctx,
  session: string,
  options: { servedOnly?: boolean } = {},
): Promise<void> {
  if (!SESSION_ID.test(session)) return
  const now = ctx.clock.now()
  await updateSessions(ctx, session, (sessions) => {
    const entry = sessions[session]
    if (entry) sessions[session] = { ...entry, compactAt: now }
    else if (!options.servedOnly) sessions[session] = { servedAt: now, compactAt: now, matched: [] }
  })
}

type Found = { block: { text: string; ids: string[] } | null; matched: string[] }
const NOTHING: Found = { block: null, matched: [] }

async function openReadyService(
  ctx: Ctx,
  make: () => MemoryService,
  opened: { service?: MemoryService; abandoned?: boolean },
): Promise<{ service: MemoryService; project: string } | null> {
  const repo = await resolveRepo(ctx)
  if (!repo.ok || opened.abandoned) return null
  // A machine that never saved a lesson has no catalog, and a message does not create one.
  if (!(await ctx.fs.exists(join(ctx.home, "memory", "catalog.sqlite"))) || opened.abandoned)
    return null
  const service = make()
  opened.service = service
  // The caller gave up while this lookup was still resolving: it has already cleaned up, so a
  // service made now is closed here and nothing more is read.
  if (opened.abandoned) {
    await service.close().catch(() => {})
    return null
  }
  const project = repo.data.id
  await service.registerProject({
    id: project,
    automatic: true,
    name: basename(repo.data.root),
    root: repo.data.root,
  })
  await service.registerPersonal()
  const settings = await service.settings({})
  if (!settings.enabled || settings.sessions === false) return null
  return { service, project }
}

async function loadPinnedLessons(
  service: MemoryService,
  project: string,
): Promise<MemoryPreview[]> {
  // This repository's pinned lessons, then the person's, five in all.
  const pinnedOf = async () =>
    [...(await service.pinned(project)), ...(await service.pinned(PERSONAL_PROJECT))].slice(
      0,
      PINNED_MAX,
    )
  const pinned = await pinnedOf()
  // A pinned lesson whose files changed long ago retires when its states are read: read them first.
  if (pinned.length === 0) return pinned
  await service.sources(project).catch(() => null)
  return pinnedOf()
}

async function loadMatchedLessons(
  service: MemoryService,
  project: string,
  input: { message?: string; reason: BlockReason },
  known: SessionEntry | undefined,
  pins: ReadonlySet<string>,
): Promise<MemoryPreview[]> {
  // Task answers stay out of automatic matches. Changed files do not invalidate a lesson: include
  // it with its sources-changed mark so the agent can check whether the reason still holds.
  const eligible = (lesson: Pick<MemoryPreview, "id" | "sources" | "tags">) =>
    !pins.has(lesson.id) && !lesson.tags.includes(ANSWER_TAG)
  if (input.reason === "compact") {
    const matched: MemoryPreview[] = []
    for (const id of known?.matched ?? []) {
      try {
        const { content, ...rest } = await service.read(id)
        const inScope = rest.project === project || rest.project === PERSONAL_PROJECT
        if (inScope && rest.state === "active" && eligible(rest))
          matched.push({ ...rest, preview: content.slice(0, 240) })
      } catch {
        // A lesson that is gone is simply not sent again.
      }
    }
    return matched
  }
  const trimmed = (input.message ?? "").trim()
  if (!trimmed) return []
  // One search over both, the message embedded once.
  const found = await service.searchProjects(
    [project, PERSONAL_PROJECT],
    (input.message as string).slice(0, MESSAGE_MAX_CHARS),
    PINNED_MAX + MATCHED_MAX,
  )
  return composeHits(
    (found.lessons[0] ?? []).filter(eligible),
    (found.lessons[1] ?? []).filter(eligible),
    MATCHED_MAX,
  )
}

async function find(
  ctx: Ctx,
  input: { message?: string; reason: BlockReason },
  known: SessionEntry | undefined,
  make: () => MemoryService,
  opened: { service?: MemoryService; abandoned?: boolean },
): Promise<Found> {
  const ready = await openReadyService(ctx, make, opened)
  if (!ready) return NOTHING
  const { service, project } = ready
  const pinned = await loadPinnedLessons(service, project)
  const pins = new Set(pinned.map((lesson) => lesson.id))
  const matched = await loadMatchedLessons(service, project, input, known, pins)
  const ids = matched.map((lesson) => lesson.id)
  if (pinned.length + matched.length === 0) {
    // Nothing to show, but the agent still learns that lessons exist and how to search them.
    const total =
      (await service.overview(project)).total + (await service.overview(PERSONAL_PROJECT)).total
    return { block: total > 0 ? { text: HINT, ids: [] } : null, matched: ids }
  }
  // A lesson whose files changed since it was checked says so on its line; Git is read once per HEAD.
  const states = await service.sources(project).catch(() => null)
  const changed = new Set(
    [...pinned, ...matched]
      .filter((row) => states?.get(row.id)?.state === "changed")
      .map((row) => row.id),
  )
  return { block: fitSessionBlock(pinned, matched, changed), matched: ids }
}

/** Fails when the work is still running after `ms`; the timer never keeps a hook process alive. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The lesson lookup ran out of time")), ms)
  })
  try {
    return await Promise.race([work, limit])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The block for a session, or `null` text when it must not be sent: sessions off, memory paused, no
 * Git repository, no lessons, a session already served (or, after a compaction, one never marked),
 * or a lookup that failed or ran out of time. It never throws.
 */
export async function sessionBlock(
  ctx: Ctx,
  input: { cwd: string; session: string; message?: string; reason: BlockReason },
  options: { make?: () => MemoryService; timeoutMs?: number } = {},
): Promise<SessionBlock> {
  if (!SESSION_ID.test(input.session)) return { text: null }
  const known = (await readSessions(ctx)).sessions[input.session]
  if (input.reason === "first" ? known !== undefined : known?.compactAt === undefined)
    return { text: null }
  const opened: { service?: MemoryService; abandoned?: boolean } = {}
  let found: Found = NOTHING
  let issue: string | undefined
  try {
    let where = input.cwd
    try {
      where = realpathSync(input.cwd)
    } catch {
      // The directory as the agent names it is used as it is.
    }
    const scoped: Ctx = {
      ...ctx,
      env: {
        get: (name) => (name === "QUALITYLAYER_TASK" ? undefined : ctx.env.get(name)),
        cwd: () => where,
      },
    }
    found = await within(
      find(scoped, input, known, options.make ?? (() => memoryService(scoped)), opened),
      options.timeoutMs ?? LOOKUP_TIMEOUT_MS,
    )
  } catch {
    issue = ISSUE
    found = { block: null, matched: known?.matched ?? [] }
  } finally {
    // Whatever is still running past here sees this and closes what it opens itself.
    opened.abandoned = true
    await opened.service?.close().catch(() => {})
  }
  try {
    const now = ctx.clock.now()
    await updateSessions(ctx, input.session, (sessions) => {
      sessions[input.session] = {
        servedAt: now,
        matched: found.matched,
        ...(issue ? { memory_issue: issue } : {}),
      }
    })
  } catch {
    // A session that cannot be recorded may be sent its lessons again; it is never failed.
  }
  return found.block ?? { text: null, ...(issue ? { issue } : {}) }
}

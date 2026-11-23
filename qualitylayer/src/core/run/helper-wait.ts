import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"
import { HELPER_STALE_MS } from "../wait-rules.ts"

export type HelperWaitSummary = {
  count: number
  roles: string[]
  line: string | null
  startedAt: number
  latestAt: number
  expiresAt: number
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const time = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

type ActiveHelper = { role: string; started: number; at: number; line: string | null }

async function readHelperFile(
  ctx: Ctx,
  runtimeDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await ctx.fs.readFile(join(runtimeDir, "helpers.json"))
    if (text.length > 512_000) return null
    const parsed: unknown = JSON.parse(text)
    return object(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isOpenHelperFile(file: Record<string, unknown>, stage: Task["stage"]): boolean {
  const matchesStage = file.stage === stage && file.recorded !== true
  return matchesStage && Array.isArray(file.ids) && object(file.lines) && time(file.started)
}

function parseActiveHelper(
  row: unknown,
  roleValue: unknown,
  fileStarted: number,
  now: number,
): ActiveHelper | null {
  if (!object(row) || row.done === true) return null
  if (!time(row.started) || !time(row.at)) return null
  const inWindow = row.started >= fileStarted && row.at >= row.started && row.at <= now
  if (!inWindow || now - row.at >= HELPER_STALE_MS) return null
  return {
    role:
      typeof roleValue === "string" && /^[a-z][a-z-]{0,31}$/.test(roleValue) ? roleValue : "helper",
    started: row.started,
    at: row.at,
    line: typeof row.line === "string" ? row.line.replace(/\s+/g, " ").trim().slice(0, 300) : null,
  }
}

/** The App's current helper set: reported work awaits completion, not a new orchestrator turn. */
export async function taskHelperWait(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "stage">,
): Promise<HelperWaitSummary | null> {
  const file = await readHelperFile(ctx, task.runtimeDir)
  if (!file || !isOpenHelperFile(file, task.stage)) return null
  const now = ctx.clock.now()
  const lines = file.lines as Record<string, unknown>
  const roles = object(file.roles) ? file.roles : {}
  const fileStarted = file.started as number
  const active: ActiveHelper[] = []
  for (const id of (file.ids as unknown[]).slice(0, 64)) {
    if (typeof id !== "string") continue
    const parsed = parseActiveHelper(lines[id], roles[id] ?? file.role, fileStarted, now)
    if (parsed) active.push(parsed)
  }
  if (!active.length) return null
  const latest = active.reduce((one, row) => (row.at > one.at ? row : one))
  return {
    count: active.length,
    roles: [...new Set(active.map((row) => row.role))],
    line: latest.line,
    startedAt: Math.min(...active.map((row) => row.started)),
    latestAt: latest.at,
    expiresAt: latest.at + HELPER_STALE_MS,
  }
}

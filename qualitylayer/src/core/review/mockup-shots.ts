// The rendered mockups the Plan review looks at: for each `ql:artifact` the Plan names, the latest
// `artifact shot` pictures (one light desktop, one phone of 390 px). `artifact shot` keeps them as
// `<name>-<theme>-<width>.png` in the project's artifacts runtime folder; a reviewer that only reads
// the HTML source cannot say how the artifact looks, so it is handed the pictures themselves.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { parseArtifactReference } from "../artifact/reference.ts"
import { projectArtifactsRuntime } from "../artifact/store.ts"
import { extractFences } from "../docs/fence-scanner.ts"
import { parseFence, SURFACES } from "../docs/fragments.ts"
import { parseMarkers } from "../docs/markers.ts"
import { folderDoc } from "../docs/names.ts"
import type { Task } from "../task/store.ts"

export type MockupShots = {
  artifact: string
  fence?: boolean
  width?: number
  /** The latest light picture of a desktop width, or null. */
  desktop: string | null
  /** The latest light picture of a phone width (up to 480 px), or null. */
  phone: string | null
}

export function namedPlanFences(task: Pick<Task, "slug">, plan: string) {
  return extractFences(plan).flatMap((fence) => {
    if (fence.kind !== "wireframe") return []
    const parsed = parseFence("wireframe", fence.body)
    const name = parsed.header.name
    if (parsed.fragment === "" || name === undefined) return []
    const digest = createHash("sha256").update(fence.body).digest("hex").slice(0, 12)
    return [
      {
        name,
        source: fence.body,
        width: SURFACES[parsed.header.surface ?? "desktop"] ?? 840,
        prefix: `fence-${task.slug}-${name}-${digest}-light-`,
      },
    ]
  })
}

const PHONE_MAX = 480
const DESKTOP_MIN = 768

/** The names of the artifacts a Plan shows with `ql:artifact <name>`, once each, in order. */
async function artifactsNamed(ctx: Ctx, task: Task): Promise<string[]> {
  const plan = join(task.dir, folderDoc("plan"))
  if (!(await ctx.fs.exists(plan))) return []
  const names: string[] = []
  for (const marker of parseMarkers(await ctx.fs.readFile(plan)).markers) {
    const name =
      marker.name === "artifact" ? parseArtifactReference(marker.args[0] ?? "")?.key : undefined
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

const regexSafe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

async function readShotFiles(ctx: Ctx, folder: string | null): Promise<string[]> {
  if (folder === null || !(await ctx.fs.exists(folder))) return []
  try {
    return await ctx.fs.readdir(folder)
  } catch {
    return []
  }
}

async function latestArtifactShot(
  ctx: Ctx,
  folder: string | null,
  files: readonly string[],
  artifact: string,
): Promise<MockupShots> {
  const pattern = new RegExp(`^${regexSafe(artifact)}-light-(\\d+)\\.png$`)
  let desktop: { path: string; at: number } | null = null
  let phone: { path: string; at: number } | null = null
  for (const file of files) {
    const width = Number(pattern.exec(file)?.[1])
    if (!Number.isFinite(width) || folder === null) continue
    const path = join(folder, file)
    const at = (await ctx.fs.stat?.(path))?.mtimeMs
    if (at === undefined) continue
    if (width >= DESKTOP_MIN && (desktop === null || at > desktop.at)) desktop = { path, at }
    if (width <= PHONE_MAX && (phone === null || at > phone.at)) phone = { path, at }
  }
  return { artifact, desktop: desktop?.path ?? null, phone: phone?.path ?? null }
}

function fenceShot(
  folder: string | null,
  files: readonly string[],
  fence: ReturnType<typeof namedPlanFences>[number],
): MockupShots {
  const file = `${fence.prefix}${fence.width}.png`
  const path = folder !== null && files.includes(file) ? join(folder, file) : null
  return {
    artifact: fence.name,
    fence: true,
    width: fence.width,
    desktop: fence.width > PHONE_MAX ? path : null,
    phone: fence.width <= PHONE_MAX ? path : null,
  }
}

/** The shots on disk for each artifact the Plan names; an artifact with none has both fields null. */
export async function mockupShots(ctx: Ctx, task: Task): Promise<MockupShots[]> {
  const names = await artifactsNamed(ctx, task)
  const planPath = join(task.dir, folderDoc("plan"))
  const fences = (await ctx.fs.exists(planPath))
    ? namedPlanFences(task, await ctx.fs.readFile(planPath))
    : []
  if (names.length === 0 && fences.length === 0) return []
  const folder =
    typeof task.repoId === "string"
      ? join(projectArtifactsRuntime(ctx, task.repoId), "shots")
      : null
  const files = await readShotFiles(ctx, folder)
  const out: MockupShots[] = []
  for (const artifact of names) out.push(await latestArtifactShot(ctx, folder, files, artifact))
  for (const fence of fences) out.push(fenceShot(folder, files, fence))
  return out
}

/** The pictures of every artifact, for an agent that takes images as attachments. */
export const shotPaths = (shots: readonly MockupShots[]): string[] =>
  shots.flatMap((s) => [s.desktop, s.phone].filter((p): p is string => p !== null))

export { mockupSection } from "./mockup-section.ts"

// An artifact drawn to a PNG by a Chrome or Chromium on this machine, driven over its DevTools socket:
// `artifact shot` for the agent to look at its own work, and the Artifacts tab's thumbnails. The page is
// loaded from a file in a throwaway profile with a policy that allows no network, so an artifact shows
// exactly what the App shows. One browser draws a whole batch, then ends with its profile.

import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { projectArtifactsRuntime } from "../core/artifact/store.ts"
import { fencePage } from "../core/docs/fence-page.ts"
import { folderDoc } from "../core/docs/names.ts"
import { ARTIFACT_REVISIONS_KEPT, capFolder } from "../core/home-caps.ts"
import { renameWithRetry } from "../core/platform.ts"
import { namedPlanFences } from "../core/review/mockup-shots.ts"
import type { Task } from "../core/task/store.ts"
import type { Ctx } from "../ctx.ts"
import panelCSS from "../ui/reader/panel.css" with { type: "text" }
import wireCSS from "../ui/reader/wire.css" with { type: "text" }
import { withPolicy } from "./artifact-bridge.ts"
import { type Send, startChrome } from "./render-chrome.ts"
import type { ShotSpec } from "./render-diagnostics.ts"
import { findChrome } from "./render-locate.ts"
import { shootOne } from "./render-shoot.ts"

export { stopRenderBrowsers } from "./render-chrome.ts"
export type { ShotDiagnostics, ShotSpec, UrlShotSpec } from "./render-diagnostics.ts"
export { captureRequestAllowed, findChrome, loopbackUrl, NO_CHROME } from "./render-locate.ts"
export { renderUrl } from "./render-url.ts"

type RenderBudget = { maxBytes: number; maxPixels: number; timeoutMs: number }
type BudgetTotals = { bytes: number; pixels: number }

async function shootWithinBudget(
  send: Send,
  page: string,
  spec: ShotSpec,
  deadline: number,
  budget?: RenderBudget,
): Promise<Uint8Array> {
  if (!budget) return shootOne(send, page, spec)
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error("Export rendering timed out")
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      shootOne(send, page, spec),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Export rendering timed out")), remaining)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function accountBudget(
  picture: Uint8Array,
  spec: ShotSpec,
  totals: BudgetTotals,
  budget?: RenderBudget,
): void {
  totals.bytes += picture.byteLength
  if (!budget) return
  if (spec.format !== "pdf" && picture.byteLength >= 24) {
    const size = new DataView(picture.buffer, picture.byteOffset, picture.byteLength)
    totals.pixels += size.getUint32(16) * size.getUint32(20)
  }
  if (totals.bytes > budget.maxBytes || totals.pixels > budget.maxPixels)
    throw new Error("Export rendering exceeds its size limit")
}

/**
 * Draw each artifact of a batch with one browser. An artifact that fails is an Error in its place; a
 * browser that does not start fails the whole batch.
 */
export async function renderArtifacts(
  chrome: string,
  jobs: { html: string; spec: ShotSpec }[],
  budget?: RenderBudget,
): Promise<(Uint8Array | Error)[]> {
  const profile = await mkdtemp(join(tmpdir(), "ql-artifact-chrome-"))
  let exited = false
  try {
    const browser = await startChrome(chrome, profile, () => {
      exited = true
    })
    try {
      const out: (Uint8Array | Error)[] = []
      const deadline = Date.now() + (budget?.timeoutMs ?? Number.POSITIVE_INFINITY)
      const totals: BudgetTotals = { bytes: 0, pixels: 0 }
      for (const [index, job] of jobs.entries()) {
        const page = join(profile, `artifact-${index}.html`)
        await writeFile(page, withPolicy(job.html), "utf8")
        try {
          const picture = await shootWithinBudget(browser.send, page, job.spec, deadline, budget)
          accountBudget(picture, job.spec, totals, budget)
          out.push(picture)
        } catch (cause) {
          if (budget) throw cause
          out.push(cause instanceof Error ? cause : new Error(String(cause)))
        }
      }
      return out
    } finally {
      await browser.stop()
    }
  } finally {
    // Only the profile this call made, in the system's temporary folder.
    if (exited && profile.startsWith(`${tmpdir()}${sep}ql-artifact-chrome-`))
      await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

/** Write a picture where it was asked for. */
export async function writePicture(path: string, png: Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, png, { flag: "wx", mode: 0o600 })
    await renameWithRetry(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Capture current named fences before the reviewer starts reading the draft. */
export async function renderPlanFences(ctx: Ctx, task: Task): Promise<void> {
  if (task.stage !== "plan") return
  const plan = join(task.dir, folderDoc("plan"))
  if (!(await ctx.fs.exists(plan))) return
  const fences = namedPlanFences(task, await ctx.fs.readFile(plan))
  if (fences.length === 0) return
  const chrome = findChrome((name) => ctx.env.get(name))
  if (chrome === null) return
  const folder = join(projectArtifactsRuntime(ctx, task.repoId), "shots")
  await ctx.fs.mkdir(folder)
  const jobs = fences.map((fence) => ({
    html: fencePage("wireframe", fence.source, "light", { wire: wireCSS, panel: panelCSS }) ?? "",
    spec: { width: fence.width, theme: "light" as const },
  }))
  // A browser failure leaves source-only review available; no older digest can stand in for it.
  const pictures = await renderArtifacts(chrome, jobs).catch(() => [])
  for (const [index, fence] of fences.entries()) {
    const picture = pictures[index]
    if (picture === undefined || picture instanceof Error) continue
    await writePicture(join(folder, `${fence.prefix}${fence.width}.png`), picture)
  }
  await capFolder(ctx, folder, ARTIFACT_REVISIONS_KEPT, (name) =>
    /^fence-.+-light-\d+\.png$/.test(name),
  )
}

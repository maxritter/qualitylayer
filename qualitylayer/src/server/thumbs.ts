// The Artifacts tab's thumbnails: a small picture of the top of each artifact, drawn once per version of
// its file by a local Chrome in the background and kept in QualityLayer's folder. A list never waits
// for one: an artifact without its picture yet shows a placeholder, and the picture's file appearing in
// the watched folder brings the list back with it. Without a Chrome nothing is drawn.

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { projectArtifactsRuntime } from "../core/artifact/store.ts"
import { THUMB_FILES_KEPT, THUMB_MAX_BYTES, THUMB_QUEUE_KEPT } from "../core/home-caps.ts"
import type { Ctx } from "../ctx.ts"
import { renderArtifacts, writePicture } from "./render.ts"
import {
  identityOf,
  pruneThumbFolder,
  readThumbBatch,
  thumbRenderInputs,
  trimMap,
  trimSet,
} from "./thumbs-io.ts"

export { oldThumbnails } from "./thumbs-io.ts"

/** Bumped when the pictures are drawn differently, so the old ones are not used again. */
const DRAWING = "1"
/** How many artifacts one browser draws before it ends. */
const BATCH = 8

export type ThumbJob = {
  repoId: string
  key: string
  path: string
  /** The page's HTML when the file at `path` is not the page itself (a folder artifact's packed page). */
  render?: () => Promise<string | null>
}

export class Thumbs {
  private queue: (ThumbJob & { identity: string })[] = []
  /** Asked for, drawn or failed this run: never asked for twice. */
  private asked = new Set<string>()
  private rendered = new Set<string>()
  private running: Promise<void> | null = null
  private latest = new Map<string, { repo: string; key: string }>()

  constructor(
    private readonly ctx: Ctx,
    private readonly chrome: () => string | null,
    private readonly draw = renderArtifacts,
  ) {}

  key(path: string, mtime: number, size: number): string {
    return createHash("sha256")
      .update(`${DRAWING}:${path}:${mtime}:${size}`)
      .digest("hex")
      .slice(0, 20)
  }

  file(repoId: string, key: string): string {
    return join(projectArtifactsRuntime(this.ctx, repoId), "thumbs", `${key}.png`)
  }

  /** The picture's key when it is drawn; otherwise it is asked for in the background, and null. */
  lookup(
    repoId: string,
    path: string,
    mtime: number,
    size: number,
    render?: ThumbJob["render"],
  ): string | null {
    const key = this.key(path, mtime, size)
    const identity = identityOf(repoId, path)
    this.latest.delete(identity)
    this.latest.set(identity, { repo: repoId, key })
    trimMap(this.latest, THUMB_FILES_KEPT)
    if (existsSync(this.file(repoId, key))) return key
    if (this.rendered.delete(key)) this.asked.delete(key)
    if (this.asked.has(key) || this.chrome() === null) return null
    this.asked.add(key)
    this.queue = this.queue.filter((job) => {
      if (job.identity !== identity) return true
      this.asked.delete(job.key)
      return false
    })
    this.queue.push({ repoId, key, path, identity, ...(render !== undefined ? { render } : {}) })
    while (this.queue.length > THUMB_QUEUE_KEPT) this.asked.delete(this.queue.shift()?.key ?? "")
    trimSet(this.asked, THUMB_FILES_KEPT)
    this.running ??= this.drain()
      .catch(() => {
        this.queue = []
      })
      .finally(() => {
        this.running = null
      })
    return null
  }

  /** Wait until every picture asked for so far is drawn (for the tests). */
  async idle(): Promise<void> {
    while (this.running !== null) await this.running
  }
  stats() {
    return { queued: this.queue.length, requested: this.asked.size, latest: this.latest.size }
  }
  private async prune(repoId: string) {
    const folder = join(this.file(repoId, ""), "..")
    const pinned = new Set(
      [...this.latest.values()]
        .filter((entry) => entry.repo === repoId)
        .map((entry) => `${entry.key}.png`),
    )
    await pruneThumbFolder(folder, pinned)
  }

  private async persistPictures(
    jobs: { job: ThumbJob; html: string }[],
    pictures: (Uint8Array | Error)[],
  ): Promise<Set<string>> {
    const updated = new Set<string>()
    for (const [index, picture] of pictures.entries()) {
      const job = jobs[index]?.job
      if (job === undefined || picture instanceof Error) continue
      const isLatest = this.latest.get(identityOf(job.repoId, job.path))?.key === job.key
      if (picture.byteLength > THUMB_MAX_BYTES || !isLatest) continue
      const out = this.file(job.repoId, job.key)
      await mkdir(join(out, ".."), { recursive: true })
      await writePicture(out, picture)
      this.rendered.add(job.key)
      trimSet(this.rendered, THUMB_FILES_KEPT)
      updated.add(job.repoId)
    }
    return updated
  }

  private async drain(): Promise<void> {
    const chrome = this.chrome()
    if (chrome === null) return
    while (this.queue.length > 0) {
      const jobs = await readThumbBatch(this.queue.splice(0, BATCH))
      if (jobs.length === 0) continue
      let pictures: (Uint8Array | Error)[]
      try {
        pictures = await this.draw(chrome, thumbRenderInputs(jobs))
      } catch {
        return
      }
      const updated = await this.persistPictures(jobs, pictures)
      for (const repoId of updated) await this.prune(repoId)
    }
  }
}
